"""Agente 1 — Extrator.

Lê o PDF do edital com Gemini 2.5 Flash (multimodal) e devolve `EditalEstruturado`.
Refs: ARCHITECTURE.md §Agente 1 — Extrator.
"""
from __future__ import annotations

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
""").strip()


def extrair_edital(pdf_bytes: bytes, *, mime_type: str = "application/pdf") -> EditalEstruturado:
    """Roda o Extrator no PDF e devolve `EditalEstruturado`.

    Sobe `vertexai` na primeira chamada (cacheado por processo).
    """
    _init()
    model = GenerativeModel(MODEL_NAME, system_instruction=SYSTEM_PROMPT)
    t0 = time.time()
    response = model.generate_content(
        [
            Part.from_data(data=pdf_bytes, mime_type=mime_type),
            "Extraia agora o JSON completo do edital.",
        ],
        generation_config=GenerationConfig(temperature=0.1, response_mime_type="application/json"),
    )
    latency_ms = int((time.time() - t0) * 1000)
    raw = response.text
    parsed = json.loads(raw)
    parsed = _sanitize(parsed)
    edital = EditalEstruturado.model_validate(parsed)
    log.info(
        "extrator.done",
        extra={
            "lici_adk": {
                "agent": "extrator",
                "model": MODEL_NAME,
                "latency_ms": latency_ms,
                "pdf_bytes": len(pdf_bytes),
                "orgao": edital.orgao,
                "modalidade": edital.modalidade,
            }
        },
    )
    return edital
