"""Drive tools — Fase 4: Somador de Atestados.

Fluxo principal `somar_atestados_do_drive(edital_id)`:
  1. Resolve `drive_folder_id` para o edital via Postgres (`editais.drive_folder_id`).
     Se não houver, tenta ler de `LICI_DRIVE_FOLDER_ID` (env var de fallback).
  2. Lista a subpasta `Atestados/` da pasta do edital via Drive API.
  3. Para cada PDF, chama Gemini Flash multimodal → extrai campos estruturados.
  4. Agrupa por categoria, soma volumes.
  5. Retorna `AtestadoSomatorio` e persiste no cache Postgres (via `pg_tools`).

Auth Drive:
  - Produção: SA com Domain-Wide Delegation (impersona email do operador).
    Requer `LICI_DRIVE_IMPERSONATE_EMAIL` setado e DWD configurado no Workspace Admin.
  - Fallback: SA com acesso direto à pasta compartilhada (sem DWD).
    Funciona quando a pasta foi compartilhada com a SA diretamente.
  - Se Drive API não acessível: retorna `AtestadoSomatorio` com listas vazias
    e `drive_indisponivel=True` — o Analista Comercial não bloqueia por isso.

Refs: architecture2.md §6.2 Somador de Atestados.
"""
from __future__ import annotations

import json
import logging
import os
import time
from functools import lru_cache
from typing import Optional

import vertexai
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from vertexai.generative_models import GenerationConfig, GenerativeModel, Part

log = logging.getLogger("lici_adk.drive_tools")

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
LOCATION = os.getenv("LICI_VERTEX_LOCATION", "us-central1")
MODEL_NAME = os.getenv("LICI_FLASH_MODEL", "gemini-2.5-flash")

# Email para impersonação via DWD. Se não definido, usa SA diretamente.
IMPERSONATE_EMAIL = os.getenv("LICI_DRIVE_IMPERSONATE_EMAIL", "")

# Limite de PDFs processados por rodada (evita timeout no Cloud Run).
MAX_PDFS_POR_RODADA = int(os.getenv("LICI_DRIVE_MAX_PDFS", "30"))

# Categorias reconhecidas pelo somador (mapeamento canônico).
CATEGORIAS = {
    "GWS", "Google Workspace", "GCP", "Google Cloud",
    "GMP", "UST", "bolsa_horas", "interacoes_chatbot",
    "GFS", "outro",
}
CATEGORIA_ALIAS: dict[str, str] = {
    "workspace": "GWS",
    "google workspace": "GWS",
    "google cloud platform": "GCP",
    "cloud": "GCP",
    "google meet premium": "GMP",
    "meet premium": "GMP",
    "hora tecnica": "UST",
    "hora técnica": "UST",
    "ust": "UST",
    "bolsa de horas": "bolsa_horas",
    "chatbot": "interacoes_chatbot",
    "interacoes": "interacoes_chatbot",
    "interações": "interacoes_chatbot",
}

_vtx_initialized = False


def _init_vtx() -> None:
    global _vtx_initialized
    if not _vtx_initialized:
        vertexai.init(project=PROJECT, location=LOCATION)
        _vtx_initialized = True


# ── Auth Drive ───────────────────────────────────────────────────────────────

def _drive_service():
    """Retorna cliente Drive autenticado.

    Tenta DWD se LICI_DRIVE_IMPERSONATE_EMAIL estiver definido,
    senão usa ADC (Application Default Credentials) diretamente.
    """
    from google.auth import default as gauth_default
    from google.auth.transport.requests import Request

    SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

    if IMPERSONATE_EMAIL:
        try:
            # DWD: impersona o email do operador
            creds, _ = gauth_default(scopes=SCOPES)
            delegated = creds.with_subject(IMPERSONATE_EMAIL)  # type: ignore[attr-defined]
            return build("drive", "v3", credentials=delegated, cache_discovery=False)
        except Exception as exc:
            log.warning("drive.dwd_failed_fallback_adc", extra={"error": str(exc)})

    # ADC direto (SA com acesso à pasta compartilhada)
    creds, _ = gauth_default(scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


# ── Schemas de saída ─────────────────────────────────────────────────────────

from dataclasses import dataclass, field


@dataclass
class AtestadoExtraido:
    """Um atestado individual extraído de um PDF do Drive."""
    drive_file_id: str
    drive_file_name: str
    contratante: str = ""
    objeto: str = ""
    periodo: str = ""
    volume: float = 0.0
    unidade: str = ""
    categoria: str = "outro"
    pagina_referencia: str = ""
    satisfaz_parcela_maior_relevancia: bool = False


@dataclass
class AtestadoSomatorio:
    """Resultado agregado do somador."""
    edital_id: str
    atestados_por_categoria: dict[str, float] = field(default_factory=dict)
    atestados_contribuintes: list[AtestadoExtraido] = field(default_factory=list)
    kit_minimo_recomendado: list[AtestadoExtraido] = field(default_factory=list)
    pdfs_processados: int = 0
    pdfs_com_erro: int = 0
    drive_indisponivel: bool = False
    calculado_em: str = ""

    def to_dict(self) -> dict:
        import dataclasses
        return dataclasses.asdict(self)


# ── Extração de um PDF via Gemini Flash ──────────────────────────────────────

_EXTRACAO_PROMPT = """\
Você receberá o PDF de um atestado de capacidade técnica de um fornecedor.
Extraia as informações no JSON abaixo. Seja preciso — use SOMENTE o que está no documento.

Responda APENAS com JSON válido, sem markdown:
{
  "contratante": "nome do órgão/empresa que emitiu o atestado",
  "objeto": "breve descrição do serviço prestado (1 frase)",
  "periodo": "ex: 2021-2024 ou 24 meses",
  "volume": <número — se houver quantidade de licenças, usuários, USTs, horas; 0 se não há>,
  "unidade": "ex: usuários, licenças, UST, horas, interações — ou '' se não aplicável",
  "categoria": "GWS|GCP|GMP|UST|bolsa_horas|interacoes_chatbot|outro",
  "pagina_referencia": "ex: página 2 ou cláusula 3"
}
"""


def _extrair_pdf(file_id: str, file_name: str, drive_svc) -> AtestadoExtraido:
    """Baixa o PDF do Drive e extrai campos com Gemini Flash."""
    _init_vtx()

    try:
        # Baixa conteúdo do PDF
        request = drive_svc.files().get_media(fileId=file_id)
        import io
        fh = io.BytesIO()
        from googleapiclient.http import MediaIoBaseDownload
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        pdf_bytes = fh.getvalue()
    except HttpError as exc:
        log.warning("drive.download_failed", extra={"file_id": file_id, "error": str(exc)})
        raise

    model = GenerativeModel(MODEL_NAME)
    response = model.generate_content(
        [
            Part.from_data(data=pdf_bytes, mime_type="application/pdf"),
            _EXTRACAO_PROMPT,
        ],
        generation_config=GenerationConfig(temperature=0.1, response_mime_type="application/json"),
    )
    raw = json.loads(response.text)

    categoria_raw = str(raw.get("categoria", "outro")).strip()
    categoria = CATEGORIA_ALIAS.get(categoria_raw.lower(), categoria_raw)
    if categoria not in CATEGORIAS:
        categoria = "outro"

    return AtestadoExtraido(
        drive_file_id=file_id,
        drive_file_name=file_name,
        contratante=str(raw.get("contratante", "")),
        objeto=str(raw.get("objeto", "")),
        periodo=str(raw.get("periodo", "")),
        volume=float(raw.get("volume", 0) or 0),
        unidade=str(raw.get("unidade", "")),
        categoria=categoria,
        pagina_referencia=str(raw.get("pagina_referencia", "")),
    )


# ── Resolução da pasta de atestados ─────────────────────────────────────────

def _find_atestados_folder(drive_svc, edital_folder_id: str) -> str | None:
    """Procura a subpasta 'Atestados' dentro da pasta do edital."""
    try:
        resp = drive_svc.files().list(
            q=(
                f"'{edital_folder_id}' in parents "
                "AND mimeType = 'application/vnd.google-apps.folder' "
                "AND trashed = false"
            ),
            fields="files(id, name)",
            pageSize=50,
        ).execute()
        for f in resp.get("files", []):
            if f["name"].strip().lower() == "atestados":
                return f["id"]
        return None
    except HttpError as exc:
        log.warning("drive.list_subfolders_failed", extra={"error": str(exc)})
        return None


def _list_pdfs(drive_svc, folder_id: str) -> list[dict]:
    """Lista PDFs na pasta, ordenados por data de modificação (mais recente primeiro)."""
    try:
        resp = drive_svc.files().list(
            q=(
                f"'{folder_id}' in parents "
                "AND mimeType = 'application/pdf' "
                "AND trashed = false"
            ),
            fields="files(id, name, modifiedTime)",
            orderBy="modifiedTime desc",
            pageSize=MAX_PDFS_POR_RODADA,
        ).execute()
        return resp.get("files", [])
    except HttpError as exc:
        log.warning("drive.list_pdfs_failed", extra={"error": str(exc)})
        return []


# ── Kit mínimo recomendado ────────────────────────────────────────────────────

def _calcular_kit_minimo(
    atestados: list[AtestadoExtraido],
    volume_exigido: float,
    valor_estimado_edital: float | None = None,
) -> list[AtestadoExtraido]:
    """Seleciona subconjunto mínimo de atestados que cobre o volume exigido.

    Regra: ordena por volume desc, acumula até cobrir `volume_exigido`.
    Garante pelo menos 1 com `satisfaz_parcela_maior_relevancia=True` se existir.
    """
    if not atestados or volume_exigido <= 0:
        return []

    # Marca parcela_maior_relevancia: ≥ 4% do valor estimado (art. 67 §1º)
    limiar_pmr = (valor_estimado_edital or 0) * 0.04
    for a in atestados:
        a.satisfaz_parcela_maior_relevancia = (
            limiar_pmr > 0 and a.volume >= limiar_pmr
        )

    # Ordena: primeiro os que satisfazem PMR, depois por volume desc
    sorted_at = sorted(atestados, key=lambda a: (-int(a.satisfaz_parcela_maior_relevancia), -a.volume))
    kit: list[AtestadoExtraido] = []
    acumulado = 0.0
    for a in sorted_at:
        kit.append(a)
        acumulado += a.volume
        if acumulado >= volume_exigido:
            break
    return kit


# ── Ponto de entrada público ─────────────────────────────────────────────────

def somar_atestados_do_drive(
    edital_id: str,
    *,
    drive_folder_id: str | None = None,
    volume_exigido: float = 0.0,
    valor_estimado_edital: float | None = None,
) -> AtestadoSomatorio:
    """Soma atestados da subpasta `Atestados/` no Drive do edital.

    Args:
        edital_id: UUID do edital (usado no cache Postgres).
        drive_folder_id: ID da pasta raiz do edital no Drive.
            Se None, lê de `LICI_DRIVE_FOLDER_ID` (env var para testes).
        volume_exigido: volume mínimo total (para cálculo do kit mínimo).
        valor_estimado_edital: para calcular limiar parcela_maior_relevancia.

    Returns:
        AtestadoSomatorio — nunca levanta exceção; `drive_indisponivel=True`
        quando Drive API não está acessível.
    """
    from datetime import datetime, timezone

    folder_id = drive_folder_id or os.getenv("LICI_DRIVE_FOLDER_ID", "")
    result = AtestadoSomatorio(
        edital_id=edital_id,
        calculado_em=datetime.now(timezone.utc).isoformat(),
    )

    if not folder_id:
        log.warning("drive.no_folder_id", extra={"edital_id": edital_id})
        result.drive_indisponivel = True
        return result

    try:
        drive_svc = _drive_service()
    except Exception as exc:
        log.warning("drive.auth_failed", extra={"error": str(exc)})
        result.drive_indisponivel = True
        return result

    # Localizar subpasta Atestados/
    atestados_folder_id = _find_atestados_folder(drive_svc, folder_id)
    if not atestados_folder_id:
        log.info("drive.atestados_folder_not_found", extra={"edital_id": edital_id, "folder_id": folder_id})
        result.drive_indisponivel = False  # pasta existe, só não tem subpasta
        return result

    pdfs = _list_pdfs(drive_svc, atestados_folder_id)
    log.info(
        "drive.pdfs_encontrados",
        extra={"edital_id": edital_id, "count": len(pdfs)},
    )

    atestados_extraidos: list[AtestadoExtraido] = []
    categorias_soma: dict[str, float] = {}

    for pdf in pdfs:
        try:
            t0 = time.time()
            at = _extrair_pdf(pdf["id"], pdf["name"], drive_svc)
            latency_ms = int((time.time() - t0) * 1000)
            atestados_extraidos.append(at)
            categorias_soma[at.categoria] = categorias_soma.get(at.categoria, 0.0) + at.volume
            result.pdfs_processados += 1
            log.info(
                "drive.pdf_extraido",
                extra={
                    "file": pdf["name"],
                    "categoria": at.categoria,
                    "volume": at.volume,
                    "latency_ms": latency_ms,
                },
            )
        except Exception as exc:
            result.pdfs_com_erro += 1
            log.warning(
                "drive.pdf_extracao_falhou",
                extra={"file": pdf["name"], "error": str(exc)},
            )

    result.atestados_contribuintes = atestados_extraidos
    result.atestados_por_categoria = categorias_soma
    result.kit_minimo_recomendado = _calcular_kit_minimo(
        atestados_extraidos,
        volume_exigido=volume_exigido,
        valor_estimado_edital=valor_estimado_edital,
    )

    log.info(
        "drive.somatorio_completo",
        extra={
            "edital_id": edital_id,
            "categorias": categorias_soma,
            "pdfs_ok": result.pdfs_processados,
            "pdfs_erro": result.pdfs_com_erro,
        },
    )
    return result
