"""Price Workbench — pipeline de validação de fontes trazidas pelo usuário.

Implementação MVP (Sprint B):
- URL: fetch + allow-list de domínios .gov.br + extração via regex/Gemini Flash (stub)
- Texto colado: extração via regex/Gemini Flash (stub)
- Arquivo/print: marcação como pendente (Document AI será integrado em sprint posterior)

Guardrails aplicados:
- G3: marketplace bloqueado
- G6: fonte sem origem rastreável → descartada
- G11: paramétrico exige justificativa
- G13/G14/G15: faixa de score, deduplicação
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from xerticaproc.backend.models.copilot_schemas import (
    ClassificacaoPreco,
    FonteUsuario,
    FonteUsuarioStatus,
)

log = logging.getLogger(__name__)

# Allow-list de domínios oficiais
ALLOWED_DOMAINS = {
    "pncp.gov.br",
    "www.pncp.gov.br",
    "compras.gov.br",
    "www.compras.gov.br",
    "comprasnet.gov.br",
    "www.comprasnet.gov.br",
    "paineldeprecos.planejamento.gov.br",
}

# Domínios bloqueados explicitamente (G3 marketplace)
BLOCKED_DOMAINS = {
    "mercadolivre.com.br", "amazon.com.br", "amazon.com",
    "magazineluiza.com.br", "casasbahia.com.br", "americanas.com.br",
    "shopee.com.br", "aliexpress.com",
}

# Regex para extrair valores monetários BR
RE_MONEY = re.compile(r"R\$\s?([\d\.]+(?:,\d{2})?)", re.IGNORECASE)
RE_QTD   = re.compile(r"(\d+)\s*(?:licen[çc]as?|unidades?|usu[áa]rios?|itens?)", re.IGNORECASE)
RE_VIG   = re.compile(r"(\d+)\s*meses?", re.IGNORECASE)


def _is_gov_br(host: str) -> bool:
    h = host.lower()
    return h.endswith(".gov.br") or h in ALLOWED_DOMAINS


def _money_to_float(raw: str) -> Optional[float]:
    try:
        return float(raw.replace(".", "").replace(",", "."))
    except (ValueError, AttributeError):
        return None


def _extract_from_text(text: str) -> dict:
    """Extração heurística (fallback)."""
    out: dict = {}
    if m := RE_MONEY.search(text):
        v = _money_to_float(m.group(1))
        if v is not None:
            out["valor_total"] = v
    if m := RE_QTD.search(text):
        try:
            out["quantidade"] = float(m.group(1))
        except ValueError:
            pass
    if m := RE_VIG.search(text):
        try:
            out["vigencia_meses"] = int(m.group(1))
        except ValueError:
            pass
    return out


async def _extract_with_gemini(text: str) -> Optional[dict]:
    """Extrai estrutura via Gemini Flash com JSON forçado.

    Retorna None se LLM indisponível ou falhar — caller cai no regex.
    """
    import json
    import os
    snippet = text[:6000]
    prompt = (
        "Você é um extrator de dados de contratos públicos brasileiros. "
        "Analise o texto abaixo e retorne APENAS JSON válido com as chaves: "
        "valor_total (number, R$ total do contrato), "
        "quantidade (number, qtd de licenças/unidades/usuários), "
        "vigencia_meses (integer, duração em meses), "
        "produto (string, nome do produto/serviço). "
        "Use null para campos ausentes. Não inclua explicações.\n\n"
        f"Texto:\n{snippet}"
    )
    try:
        if os.environ.get("VERTEX_PROJECT") or os.environ.get("GCP_PROJECT_ID"):
            import vertexai
            from vertexai.generative_models import GenerationConfig, GenerativeModel
            project = os.environ.get("GCP_PROJECT_ID") or os.environ.get("VERTEX_PROJECT")
            location = os.environ.get("GCP_LOCATION", "us-central1")
            vertexai.init(project=project, location=location)
            model = GenerativeModel(
                os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
            )
            cfg = GenerationConfig(
                temperature=0.0, max_output_tokens=512,
                response_mime_type="application/json",
            )
            resp = await asyncio.to_thread(
                model.generate_content, prompt, generation_config=cfg,
            )
            data = json.loads(resp.text or "{}")
        elif os.environ.get("GOOGLE_API_KEY"):
            import google.generativeai as genai
            genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
            model = genai.GenerativeModel(
                os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
                generation_config={"response_mime_type": "application/json"},
            )
            resp = await asyncio.to_thread(model.generate_content, prompt)
            data = json.loads(resp.text or "{}")
        else:
            return None
        out: dict = {}
        for k in ("valor_total", "quantidade", "vigencia_meses"):
            v = data.get(k)
            if v is None:
                continue
            try:
                out[k] = int(v) if k == "vigencia_meses" else float(v)
            except (TypeError, ValueError):
                continue
        if isinstance(data.get("produto"), str) and data["produto"].strip():
            out["produto"] = data["produto"].strip()[:200]
        return out or None
    except Exception:
        log.exception("Gemini extraction failed; using regex fallback")
        return None


async def _extract_smart(text: str) -> dict:
    """Tenta Gemini primeiro; cai em regex se vazio/indisponível."""
    via_llm = await _extract_with_gemini(text)
    via_regex = _extract_from_text(text)
    merged: dict = {**via_regex, **(via_llm or {})}
    return merged


def _classify(score: float) -> ClassificacaoPreco:
    if score >= 0.75:
        return ClassificacaoPreco.DIRETA
    if score >= 0.55:
        return ClassificacaoPreco.INDIRETA
    if score >= 0.40:
        return ClassificacaoPreco.COMPLEMENTAR
    return ClassificacaoPreco.OUTLIER


def _normalize(valor_total: Optional[float], qtd: Optional[float],
               vigencia: Optional[int]) -> Optional[float]:
    if valor_total and qtd and vigencia and qtd > 0 and vigencia > 0:
        return round(valor_total / qtd / vigencia, 2)
    return None


async def _fetch_url(url: str, timeout: float = 15.0) -> tuple[int, str]:
    """Fetch best-effort. Em produção usaria httpx; aqui uso urllib em thread."""
    import urllib.request
    import urllib.error

    def _do() -> tuple[int, str]:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "XerticaProc/1.0 (+price-workbench)"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read(2_000_000).decode("utf-8", errors="ignore")
                return r.status, body
        except urllib.error.HTTPError as e:
            return e.code, str(e)
        except Exception as e:  # noqa: BLE001
            return 0, str(e)

    return await asyncio.get_running_loop().run_in_executor(None, _do)


def validate_payload(src: FonteUsuario) -> tuple[FonteUsuarioStatus, Optional[str]]:
    """Valida tipo e guardrails básicos antes de qualquer fetch.
    Retorna (status_se_falhar, observacao). Se ok, retorna (PENDENTE, None).
    """
    if src.tipo == "url":
        if not src.url:
            return FonteUsuarioStatus.DESCARTADA, "URL ausente"
        try:
            host = (urlparse(src.url).hostname or "").lower()
        except Exception:  # noqa: BLE001
            return FonteUsuarioStatus.DESCARTADA, "URL inválida"
        host_root = host[4:] if host.startswith("www.") else host
        if host_root in BLOCKED_DOMAINS or host in BLOCKED_DOMAINS:
            return FonteUsuarioStatus.DESCARTADA, "G3: marketplace não aceito como fonte oficial"
        if not _is_gov_br(host):
            return FonteUsuarioStatus.DESCARTADA, (
                f"G6: domínio '{host}' não está na allow-list (.gov.br)"
            )
    elif src.tipo == "texto_colado":
        if not (src.texto_colado and src.texto_colado.strip()):
            return FonteUsuarioStatus.DESCARTADA, "Texto vazio"
    elif src.tipo in ("arquivo", "print"):
        if not src.arquivo_gcs_uri:
            return FonteUsuarioStatus.DESCARTADA, "URI do arquivo ausente"
    return FonteUsuarioStatus.PENDENTE, None


async def validate(src: FonteUsuario) -> FonteUsuario:
    """Roda pipeline completo. Retorna FonteUsuario atualizada (sem persistir)."""
    status, obs = validate_payload(src)
    if status == FonteUsuarioStatus.DESCARTADA:
        src.status = status
        src.observacao = obs
        src.validado_em = datetime.now(timezone.utc)
        return src

    extracted: dict = {}
    if src.tipo == "url" and src.url:
        code, body = await _fetch_url(src.url)
        if code != 200 or not body:
            src.status = FonteUsuarioStatus.DESCARTADA
            src.observacao = f"Fetch falhou (HTTP {code})"
            src.validado_em = datetime.now(timezone.utc)
            return src
        extracted = await _extract_smart(body)
        if not extracted:
            src.observacao = (src.observacao or "") + " | Extração sem valores; revisão manual necessária"
    elif src.tipo == "texto_colado" and src.texto_colado:
        extracted = await _extract_smart(src.texto_colado)
    elif src.tipo in ("arquivo", "print"):
        # Document AI será integrado depois; por enquanto fica pendente
        src.status = FonteUsuarioStatus.PENDENTE
        src.observacao = "Aguardando integração Document AI (sprint posterior)"
        src.validado_em = datetime.now(timezone.utc)
        return src

    valor_total = extracted.get("valor_total") or src.valor_total
    qtd = extracted.get("quantidade") or src.quantidade
    vigencia = extracted.get("vigencia_meses") or src.vigencia_meses

    src.valor_total = valor_total
    src.quantidade = qtd
    src.vigencia_meses = vigencia
    src.valor_mensal_unitario = _normalize(valor_total, qtd, vigencia)

    # Score heurístico: domínio gov + presença de valor + normalização ok
    score = 0.30
    if src.tipo == "url" and src.url:
        host = (urlparse(src.url).hostname or "").lower()
        if host in ALLOWED_DOMAINS:
            score += 0.40
        elif host.endswith(".gov.br"):
            score += 0.30
    if valor_total:
        score += 0.15
    if src.valor_mensal_unitario is not None:
        score += 0.15
    score = min(1.0, score)

    src.score = round(score, 2)
    src.classificacao = _classify(score)
    src.status = (
        FonteUsuarioStatus.VALIDADA
        if src.valor_mensal_unitario is not None or src.valor_total is not None
        else FonteUsuarioStatus.PENDENTE
    )
    src.validado_em = datetime.now(timezone.utc)
    return src
