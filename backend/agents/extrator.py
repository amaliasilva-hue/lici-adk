"""Agente 1 — Extrator.

Lê o PDF do edital com Gemini 2.5 Flash (multimodal) e devolve `EditalEstruturado`.
Três camadas de fallback para máxima cobertura:
  Tier 1 — PDF nativo enviado como application/pdf (multimodal Gemini)
  Tier 2 — Extração de texto via pypdf → prompt de texto puro
  Tier 3 — Vision: cada página renderizada como imagem PNG pelo pymupdf
Refs: ARCHITECTURE.md §Agente 1 — Extrator.
"""
from __future__ import annotations

import io
import json
import logging
import os
import textwrap
import time

import vertexai
from vertexai.generative_models import GenerationConfig, GenerativeModel, Part

from backend.models.schemas import EditalEstruturado

log = logging.getLogger("lici_adk.extrator")

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
# Vertex AI em us-central1 — única região com Gemini 2.5 Pro disponível hoje.
LOCATION = os.getenv("LICI_VERTEX_LOCATION", "us-central1")
MODEL_NAME = os.getenv("LICI_EXTRATOR_MODEL", "gemini-2.5-flash")

_initialized = False


def _init() -> None:
    global _initialized
    if not _initialized:
        vertexai.init(project=PROJECT, location=LOCATION)
        _initialized = True


# Enums válidos do EditalEstruturado — usados para filtrar drift do LLM.
_VALID_PRECIFICACAO = {
    "USN", "USNM", "UST", "USTc", "USTa",
    "licenca_fixa", "consumo_volumetria", "bolsa_horas", "tickets",
    "desconto_percentual", "preco_global", "preco_unitario",
}
_PRECIFICACAO_ALIAS = {
    "desconto": "desconto_percentual",
    "percentual_desconto": "desconto_percentual",
    "desconto_linear": "desconto_percentual",
    "desconto_linear_sobre_tabela": "desconto_percentual",
    "desconto_sobre_tabela": "desconto_percentual",
    "global": "preco_global",
    "menor_preco_global": "preco_global",
    "unitario": "preco_unitario",
    "menor_preco_unitario": "preco_unitario",
    "consumo": "consumo_volumetria",
    "volumetria": "consumo_volumetria",
    "bolsa": "bolsa_horas",
    "horas": "bolsa_horas",
    "ticket": "tickets",
    "licenca": "licenca_fixa",
    "licenciamento": "licenca_fixa",
}


def _sanitize(d: dict) -> dict:
    """Filtra/normaliza valores de enum que o Flash às vezes inventa."""
    raw = d.get("modelo_precificacao") or []
    if isinstance(raw, str):
        # Flash às vezes devolve string única em vez de lista.
        raw = [r.strip() for r in raw.replace(";", ",").split(",") if r.strip()]
    if isinstance(raw, list):
        cleaned: list[str] = []
        for v in raw:
            if not isinstance(v, str):
                continue
            if v in _VALID_PRECIFICACAO:
                cleaned.append(v)
                continue
            low = v.strip().lower()
            if low in _PRECIFICACAO_ALIAS:
                cleaned.append(_PRECIFICACAO_ALIAS[low])
            else:
                log.warning(
                    "extrator.precificacao_descartada",
                    extra={"lici_adk": {"agent": "extrator", "valor": v}},
                )
        # dedupe preservando ordem
        seen, dedup = set(), []
        for v in cleaned:
            if v not in seen:
                seen.add(v); dedup.append(v)
        d["modelo_precificacao"] = dedup

    # Guarda-risco: exclusividade ME/EPP só é válida para valores <= R$80k.
    # Se o LLM retornou true mas valor_estimado > 80.000, derruba o flag.
    if d.get("exclusividade_me_epp") is True:
        valor = d.get("valor_estimado")
        if valor is not None and float(valor) > 80_000:
            log.warning(
                "extrator.exclusividade_me_epp_descartada",
                extra={"lici_adk": {"valor_estimado": valor}},
            )
            d["exclusividade_me_epp"] = False

    return d


SYSTEM_PROMPT = textwrap.dedent("""
Você é o Agente Extrator do lici-adk. Leia o edital anexado (PDF) e devolva APENAS
um JSON válido conforme o schema abaixo — sem prosa antes ou depois.

SCHEMA (campos ausentes = null; listas vazias = []):
{
  "objeto": "descrição objetiva do objeto licitado",
  "orgao": "nome do órgão + UF",
  "uf": "SP",
  "uasg": "533201",
  "modalidade": "Pregão Eletrônico|Adesão a Ata|ETEC|...",
  "data_encerramento": "YYYY-MM-DD",
  "prazo_questionamento": "YYYY-MM-DD",
  "duracao_contrato": "24 meses",
  "valor_estimado": 0.0,
  "portal": "BEC|Comprasnet|Licitações-e|...",
  "requisitos_tecnicos": ["..."],
  "requisitos_habilitacao": ["SICAF", "CND Federal", "..."],
  "garantia_contratual": "5% do valor do contrato",
  "nivel_parceria_exigido": "Google Cloud Premier Partner",
  "certificacoes_corporativas_exigidas": ["ISO 27001", "..."],
  "certificacoes_profissionais_exigidas": ["Professional Cloud Architect", "..."],
  "volumetria_exigida": [{"dimensao": "contas_workspace", "quantidade": 400, "unidade": "usuários"}],
  "modelo_precificacao": ["USN"|"UST"|"USTa"|"bolsa_horas"|"tickets"|"licenca_fixa"|"consumo_volumetria"],
  "tabela_proporcionalidade_ust": {"Especialista": 1.30},
  "nivel_sla_critico": "P1 em 2h úteis",
  "penalidades_glosa_max_pct": 50,
  "exclusividade_me_epp": false,
  "vedacao_consorcio": false,

  "subcontratacao_permitida": "livre|parcial|vedada",
  "exige_poc_mvp": false,
  "prazo_poc": null,
  "modelo_inovacao_etec": false,
  "restricao_temporal_experiencia_meses": 36,
  "localizacao_dados_exigida": "Brasil — BACEN Res. 4.893",
  "dependencias_terceiros_identificadas": ["WhatsApp Business API"],
  "strict_match_atestados": false,
  "match_familia_permitido": true,
  "keywords_busca": ["google cloud", "vertex ai", "chatbot"]
}

REGRAS:
- Extraia literalmente do edital. Se um campo não está presente, devolva null ou [].
- `strict_match_atestados=true` SOMENTE se o edital disser explicitamente que NÃO aceita atestados similares.
- `keywords_busca` deve ter 5-10 termos técnicos centrais para o Qualificador buscar atestados.
- `modelo_inovacao_etec=true` quando aparecer "Encomenda Tecnológica", "Marco Legal das Startups" ou "Chamamento Público de Inovação".

REGRAS CRÍTICAS — FLAGS BOOLEANAS:
- `exclusividade_me_epp=true` SOMENTE se o edital contiver literalmente "exclusivo para ME/EPP",
  "participação exclusiva de microempresas e empresas de pequeno porte", ou equivalente explícito
  com base no Art. 48, I da LC 123/2006.
  ATENÇÃO: editais de valor_estimado > R$ 80.000 raramente são exclusivos para ME/EPP e
  exigem justificativa específica. Se o valor estimado for > 80000 e não houver cláusula
  EXPLÍCITA de exclusividade, devolva false.
  NÃO confunda: edital de ÓRGÃO EDUCACIONAL (IFMT, IFSP, UFMG etc.) ≠ exclusividade ME/EPP.
  O fato de o objeto ser "educação" ou "licença educacional" NÃO implica ME/EPP.
- `vedacao_consorcio=true` SOMENTE se o edital expressamente proibir consórcios.
""").strip()


# ── Configuração dos fallbacks ────────────────────────────────────────────────

# Nº máximo de páginas renderizadas no modo Vision — cobre editais de até ~400 pág.
MAX_VISION_PAGES = int(os.getenv("LICI_EXTRATOR_MAX_VISION_PAGES", "120"))

# Páginas por chunk no modo Vision (Gemini suporta bem até ~30 imgs por chamada).
VISION_CHUNK_SIZE = int(os.getenv("LICI_EXTRATOR_VISION_CHUNK_SIZE", "30"))

# Fator de zoom ao renderizar páginas como imagem (2.0 ≈ 150 DPI → boa OCR).
_VISION_ZOOM = float(os.getenv("LICI_EXTRATOR_VISION_ZOOM", "2.0"))

# Mínimo de caracteres de texto nativo para o PDF ser considerado "textual".
_MIN_TEXT_LEN = int(os.getenv("LICI_EXTRATOR_MIN_TEXT_LEN", "300"))

# Tamanho máximo de cada chunk de texto enviado ao Gemini (200k chars ≈ 150 pág densas).
_TEXT_CHUNK_SIZE = int(os.getenv("LICI_EXTRATOR_TEXT_CHUNK_SIZE", "200000"))

# Nº máximo de chunks de texto processados (evita explosão em docs de 1000 pág).
_MAX_TEXT_CHUNKS = int(os.getenv("LICI_EXTRATOR_MAX_TEXT_CHUNKS", "3"))


# ── Helpers internos ──────────────────────────────────────────────────────────

def _extract_text_pypdf(pdf_bytes: bytes) -> str:
    """Extrai texto nativo do PDF com pypdf (puro Python, sem deps de sistema)."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        log.warning("extrator.pypdf_failed", extra={"lici_adk": {"error": str(exc)}})
        return ""


def _render_pages_vision(pdf_bytes: bytes) -> list[Part]:
    """Renderiza até MAX_VISION_PAGES páginas do PDF como PNGs via pymupdf (sem poppler)."""
    import fitz  # pymupdf
    mat = fitz.Matrix(_VISION_ZOOM, _VISION_ZOOM)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total = len(doc)
    n = min(total, MAX_VISION_PAGES)
    parts: list[Part] = []
    for i in range(n):
        pix = doc.load_page(i).get_pixmap(matrix=mat)
        parts.append(Part.from_data(data=pix.tobytes("png"), mime_type="image/png"))
    doc.close()
    log.info("extrator.vision_rendered", extra={"lici_adk": {"pages_rendered": n, "total_pages": total}})
    return parts


def _call_gemini_raw(content_parts: list, tier_label: str) -> dict:
    """Chama Gemini e devolve o dict sanitizado sem validação Pydantic.

    Usado no processamento em chunks porque campos obrigatórios (objeto, orgao)
    podem estar ausentes em chunks intermediários.
    """
    model = GenerativeModel(MODEL_NAME, system_instruction=SYSTEM_PROMPT)
    response = model.generate_content(
        content_parts + ["Extraia agora o JSON completo do edital."],
        generation_config=GenerationConfig(temperature=0.1, response_mime_type="application/json"),
    )
    return _sanitize(json.loads(response.text))


def _call_gemini(content_parts: list, tier_label: str) -> EditalEstruturado:
    """Chama Gemini e valida o resultado como EditalEstruturado."""
    parsed = _call_gemini_raw(content_parts, tier_label)
    edital = EditalEstruturado.model_validate(parsed)
    log.info("extrator.tier_ok", extra={"lici_adk": {"tier": tier_label, "orgao": edital.orgao}})
    return edital


def _merge_dicts(base: dict, supplement: dict) -> dict:
    """Mescla dois dicts de EditalEstruturado.

    Regras:
    - Escalares: base tem prioridade; suplemento preenche campos None/vazio/curtos.
    - Listas: união sem duplicatas (preserva ordem).
    - Dicts (ex: tabela_proporcionalidade_ust): suplemento é base, base sobrescreve.
    """
    result = dict(base)
    for key, val in supplement.items():
        if val is None:
            continue
        existing = result.get(key)
        if isinstance(val, list):
            if not val:
                continue
            existing_list = existing if isinstance(existing, list) else []
            merged_list = list(existing_list)
            for item in val:
                if item not in merged_list:
                    merged_list.append(item)
            result[key] = merged_list
        elif isinstance(val, dict):
            if not val:
                continue
            base_dict = existing if isinstance(existing, dict) else {}
            merged_dict = dict(val)
            merged_dict.update(base_dict)  # base_dict tem prioridade
            result[key] = merged_dict
        else:
            # Escalar: suplemento só preenche se base está ausente ou muito curto.
            if not existing or (isinstance(existing, str) and len(existing) < 5):
                result[key] = val
    return result


def _call_gemini_chunked_text(text: str) -> EditalEstruturado:
    """Processa texto longo em chunks de _TEXT_CHUNK_SIZE chars, mescla resultados.

    O início do edital (chunk 0) geralmente tem objeto/orgao/valor; chunks seguintes
    complementam requisitos, habilitação e demais campos de lista.
    """
    raw_chunks = [text[i:i + _TEXT_CHUNK_SIZE] for i in range(0, len(text), _TEXT_CHUNK_SIZE)]
    chunks = raw_chunks[:_MAX_TEXT_CHUNKS]
    n = len(chunks)

    if n == 1:
        return _call_gemini([f"<edital_text>\n{chunks[0]}\n</edital_text>"], "texto_pypdf")

    log.info("extrator.text_chunking", extra={"lici_adk": {"total_chars": len(text), "chunks": n}})
    merged: dict | None = None
    for i, chunk in enumerate(chunks):
        label = f"texto_c{i + 1}/{n}"
        try:
            chunk_dict = _call_gemini_raw([f"<edital_text>\n{chunk}\n</edital_text>"], label)
            merged = chunk_dict if merged is None else _merge_dicts(merged, chunk_dict)
        except Exception as exc:
            log.warning("extrator.text_chunk_failed", extra={"lici_adk": {"chunk": label, "error": str(exc)}})

    if merged is None:
        raise RuntimeError("All text chunks failed")
    edital = EditalEstruturado.model_validate(merged)
    log.info("extrator.text_chunked_ok", extra={"lici_adk": {"orgao": edital.orgao, "chunks": n}})
    return edital


def _call_gemini_chunked_vision(all_parts: list[Part]) -> EditalEstruturado:
    """Processa páginas vision em chunks de VISION_CHUNK_SIZE imagens, mescla resultados.

    Chunk 0 = páginas iniciais (objeto, orgao, valor, datas).
    Chunks seguintes complementam requisitos técnicos, habilitação, glosas etc.
    """
    n_parts = len(all_parts)
    if n_parts <= VISION_CHUNK_SIZE:
        return _call_gemini(all_parts, "vision_pages")

    chunks = [all_parts[i:i + VISION_CHUNK_SIZE] for i in range(0, n_parts, VISION_CHUNK_SIZE)]
    n = len(chunks)
    log.info("extrator.vision_chunking", extra={"lici_adk": {"total_pages": n_parts, "chunks": n}})

    merged: dict | None = None
    for i, chunk in enumerate(chunks):
        label = f"vision_c{i + 1}/{n}"
        try:
            chunk_dict = _call_gemini_raw(chunk, label)
            merged = chunk_dict if merged is None else _merge_dicts(merged, chunk_dict)
        except Exception as exc:
            log.warning("extrator.vision_chunk_failed", extra={"lici_adk": {"chunk": label, "error": str(exc)}})

    if merged is None:
        raise RuntimeError("All vision chunks failed")
    edital = EditalEstruturado.model_validate(merged)
    log.info("extrator.vision_chunked_ok", extra={"lici_adk": {"orgao": edital.orgao, "chunks": n}})
    return edital


def _resultado_ok(edital: EditalEstruturado) -> bool:
    """Qualidade mínima: objeto e orgão com conteúdo real."""
    return (
        bool(edital.objeto) and len(edital.objeto) >= 10
        and bool(edital.orgao) and len(edital.orgao) >= 5
    )


# ── Função pública ────────────────────────────────────────────────────────────

def extrair_edital(pdf_bytes: bytes, *, mime_type: str = "application/pdf") -> EditalEstruturado:
    """Extrai dados do PDF com fallbacks em cascata + processamento em chunks.

    Tier 1 — PDF nativo application/pdf → Gemini Flash multimodal (OCR interno)
    Tier 2 — Texto extraído via pypdf → chunks de texto → mescla de resultados
              (melhor para PDFs digitais muito longos)
    Tier 3 — Vision: páginas renderizadas como PNG via pymupdf em chunks de 30 pág
              (melhor para PDFs escaneados, formulários, layouts complexos)
    """
    _init()
    t0 = time.time()

    # Pré-análise: verifica se o PDF tem texto extraível.
    native_text = _extract_text_pypdf(pdf_bytes)
    is_scanned = len(native_text.strip()) < _MIN_TEXT_LEN
    log.info(
        "extrator.preanalise",
        extra={"lici_adk": {"is_scanned": is_scanned, "text_chars": len(native_text)}},
    )

    edital: EditalEstruturado | None = None
    tier_used = "none"
    last_exc: Exception | None = None

    # ── Tier 1: PDF nativo multimodal ────────────────────────────────────────
    try:
        edital = _call_gemini([Part.from_data(data=pdf_bytes, mime_type=mime_type)], "pdf_nativo")
        if _resultado_ok(edital):
            tier_used = "pdf_nativo"
        else:
            log.warning("extrator.tier1_sparse", extra={"lici_adk": {"objeto": edital.objeto, "orgao": edital.orgao}})
            edital = None
    except Exception as exc:
        log.warning("extrator.tier1_failed", extra={"lici_adk": {"error": str(exc)}})
        last_exc = exc

    # ── Tier 2: texto pypdf em chunks ────────────────────────────────────────
    # Pulado para PDFs escaneados (sem texto extraível).
    if edital is None and not is_scanned and len(native_text.strip()) >= 100:
        try:
            edital = _call_gemini_chunked_text(native_text)
            if _resultado_ok(edital):
                tier_used = "texto_pypdf"
            else:
                log.warning("extrator.tier2_sparse")
                edital = None
        except Exception as exc:
            log.warning("extrator.tier2_failed", extra={"lici_adk": {"error": str(exc)}})
            last_exc = exc

    # ── Tier 3: Vision em chunks de páginas ──────────────────────────────────
    if edital is None:
        try:
            image_parts = _render_pages_vision(pdf_bytes)
            edital = _call_gemini_chunked_vision(image_parts)
            if _resultado_ok(edital):
                tier_used = "vision_pages"
            else:
                log.error("extrator.tier3_sparse")
        except Exception as exc:
            log.error("extrator.tier3_failed", extra={"lici_adk": {"error": str(exc)}})
            last_exc = exc

    if edital is None:
        raise RuntimeError(
            f"Todos os tiers do extrator falharam (pdf_nativo → texto_pypdf → vision_pages). "
            f"Último erro: {last_exc}"
        ) from last_exc

    latency_ms = int((time.time() - t0) * 1000)
    log.info(
        "extrator.done",
        extra={
            "lici_adk": {
                "agent": "extrator",
                "model": MODEL_NAME,
                "latency_ms": latency_ms,
                "pdf_bytes": len(pdf_bytes),
                "tier": tier_used,
                "is_scanned": is_scanned,
                "orgao": edital.orgao,
                "modalidade": edital.modalidade,
            }
        },
    )
    return edital
