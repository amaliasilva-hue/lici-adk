"""Agente 3 — Analista.

Recebe `EditalEstruturado` + `QualificadorResult` + perfil YAML da Xertica e
produz `ParecerFinal` com lógica em 2 camadas (bloqueadores duros → score).

Refs: ARCHITECTURE.md §Agente 3 — Analista, §Lógica de Decisão em duas camadas.
"""
from __future__ import annotations

import json
import logging
import os
import textwrap
import time
from functools import lru_cache
from pathlib import Path

import vertexai
import yaml
from vertexai.generative_models import GenerationConfig, GenerativeModel

from backend.models.schemas import EditalEstruturado, ParecerFinal, QualificadorResult

log = logging.getLogger("lici_adk.analista")

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
# Vertex AI em us-central1 — única região com Gemini 2.5 Pro disponível hoje.
LOCATION = os.getenv("LICI_VERTEX_LOCATION", "us-central1")
MODEL_NAME = os.getenv("LICI_ANALISTA_MODEL", "gemini-2.5-pro")

PROFILE_PATH = Path(__file__).resolve().parent.parent / "xertica_profile.yaml"
PROFILE_KEYS_RELEVANTES = (
    "qualificacao_empresa",
    "realidade_contratual",
    "volumetria_comprovada",
    "certidoes_empresa",
    "especializacoes_google",
    "flags_bloqueadoras",
    "narrativa_gtm",
)

_initialized = False


def _init() -> None:
    global _initialized
    if not _initialized:
        vertexai.init(project=PROJECT, location=LOCATION)
        _initialized = True


@lru_cache(maxsize=1)
def _profile_resumido() -> dict:
    """Carrega o YAML uma vez e mantém só as seções que o Analista precisa."""
    full = yaml.safe_load(PROFILE_PATH.read_text())
    return {k: full[k] for k in PROFILE_KEYS_RELEVANTES if k in full}


SYSTEM_PROMPT = textwrap.dedent("""
Você é o Agente Analista do lici-adk — consultor sênior de pré-venda para licitações
públicas da Xertica Brasil. Produz pareceres auditáveis, não marketing.

=================== LÓGICA DE DECISÃO (OBRIGATÓRIA) ===================
Duas camadas SEQUENCIAIS. NUNCA devolva "score 82 mas INAPTO".

CAMADA 1 — Bloqueadores duros (avaliar PRIMEIRO)
Se QUALQUER item abaixo disparar, devolva status=NO-GO ou INAPTO,
score_aderencia=null, preencha `bloqueio_camada_1` com a regra que disparou,
e NÃO calcule score:
  1. edital.exclusividade_me_epp=true (Xertica não é ME/EPP) → NO-GO
  2. Edital exige consórcio OBRIGATÓRIO como membro → NO-GO
  3. localizacao_dados_exigida incompatível com `southamerica-*` → INAPTO
  4. Certificação corporativa obrigatória ausente em `certidoes_empresa.certidoes_iso` → INAPTO
  5. Qualificador devolveu ZERO atestados E ZERO contratos para os requisitos técnicos
     centrais E o edital exige atestado como habilitação MANDATÓRIA → INAPTO
  6. nivel_parceria_exigido superior ao de `qualificacao_empresa.parcerias_formais` → INAPTO

CAMADA 2 — Score 0-100 (só roda se Camada 1 passar integralmente)
Soma ponderada (total 100):
  - Cobertura de requisitos técnicos por atestados+contratos (peso 50)
  - Match com `realidade_contratual.objetos_mais_comuns` / contratos âncora (peso 15)
  - Adesão a Ata viável no órgão-alvo (peso 10)
  - Premier Partner ou alinhamento com `especializacoes_google` (peso 10)
  - Certificações profissionais cobrem perfis exigidos (peso 15)
Penalidades:
  - ≥3 deals_lost com mesma Causa_Raiz: -15
  - Cada gap de volumetria numérico: -10
Thresholds: APTO ≥75 | APTO COM RESSALVAS 41-74 | INAPTO ≤40.

=================== REGRAS DE RACIOCÍNIO ===================
- USN ≡ USNM ≡ Créditos GCP ≡ Consumo Cloud — não tratar como produtos distintos.
- UST ≈ USTc ≈ USTa ≈ hora técnica base, modulada por tabela_proporcionalidade_ust.
- Glosa ≥20% ou SLA agressivo (P1 2h, 99,9%+) → alerta "ALTO RISCO DE GLOSA".
- modelo_inovacao_etec=true → recomendar narrativa FDM (Fair Decision Making) como diferencial.
- Adesão a Ata: se órgão-alvo bate com modalidades_publicas_reais → sugerir como atalho.

=================== ANTI-ALUCINAÇÃO (#10) ===================
Se o Qualificador devolveu ZERO resultados para um requisito, NUNCA invente capacidade.
Declare GAP TOTAL, score máximo 40, recomende captação de atestado com cliente similar.

=================== EVIDÊNCIAS AUDITÁVEIS ===================
Para cada requisito do edital, preencha `evidencias_por_requisito` com:
  { "requisito": "texto do requisito",
    "fonte_tabela": "atestados"|"contratos"|"closed_deals_won"|"certificados_xertica"|"xertica_profile.yaml",
    "fonte_id": "id do registro ou chave YAML",
    "trecho_literal": "trecho COPIADO do resumodoatestado/resumodocontrato que comprova",
    "tipo_evidencia": "atestado"|"contrato"|"deal_won"|"certificado"|"yaml",
    "confianca": 0.0-1.0 }

=================== ENUMS — VALORES EXATOS (case-sensitive) ===================
NUNCA invente variações. Use APENAS estes valores literais:

- `requisitos_atendidos[].fonte` ∈ {"atestado", "contrato", "deal_won", "certificado", "yaml"}
  (singular, minúsculo — NUNCA "atestados", "contratos_com_atestado", "xertica_profile.yaml")

- `evidencias_por_requisito[].fonte_tabela` ∈ {"atestados", "contratos", "closed_deals_won", "certificados_xertica", "xertica_profile.yaml"}
  (NUNCA "contratos_com_atestado" / "contratos_sem_atestado" — use sempre "contratos")

- `evidencias_por_requisito[].tipo_evidencia` ∈ {"atestado", "contrato", "deal_won", "certificado", "yaml"}

- `gaps[].tipo` ∈ {"ausencia_total", "volumetria_insuficiente", "temporal", "certificacao", "certidao"}
  (snake_case, sem acento — NUNCA "Volumetria", "Ausência Total", "Certificação")

- `status` ∈ {"APTO", "APTO COM RESSALVAS", "INAPTO", "NO-GO"} (maiúsculas exatas)

Se o requisito tem múltiplas fontes, escolha A MAIS FORTE (atestado > contrato > deal_won > certificado > yaml) e crie UMA entrada por evidência.

=================== OUTPUT (APENAS JSON) ===================
{
  "score_aderencia": null | 0-100,
  "status": "APTO" | "APTO COM RESSALVAS" | "INAPTO" | "NO-GO",
  "bloqueio_camada_1": null | "texto da regra que disparou",
  "requisitos_atendidos": [{"requisito","comprovacao","fonte","link"}],
  "evidencias_por_requisito": [...],
  "gaps": [{"requisito","tipo","delta_numerico","recomendacao"}],
  "estrategia": "recomendação objetiva de participação (2-4 parágrafos)",
  "alertas": ["..."],
  "campos_trello": {"titulo_card": "...", "checklist": ["..."]},
  "edital_orgao": "nome",
  "edital_modalidade": "Pregão..."
}
""").strip()

# Limite conservador para não estourar contexto do Pro (~1M, mas qualidade cai bem antes).
PAYLOAD_CHAR_LIMIT = 180_000

# ── Normalização defensiva: o Pro às vezes inventa variações dos enums apesar do prompt.
# Em vez de falhar a validação, mapeamos sinônimos comuns para os literais válidos.
_FONTE_REQ_MAP = {
    "atestados": "atestado",
    "contratos": "contrato",
    "contratos_com_atestado": "contrato",
    "contratos_sem_atestado": "contrato",
    "closed_deals_won": "deal_won",
    "deals_won": "deal_won",
    "certificados": "certificado",
    "certificados_xertica": "certificado",
    "xertica_profile.yaml": "yaml",
    "xertica_profile": "yaml",
    "profile": "yaml",
}
_FONTE_TABELA_MAP = {
    "atestado": "atestados",
    "contrato": "contratos",
    "contratos_com_atestado": "contratos",
    "contratos_sem_atestado": "contratos",
    "deals_won": "closed_deals_won",
    "deal_won": "closed_deals_won",
    "certificado": "certificados_xertica",
    "certificados": "certificados_xertica",
    "yaml": "xertica_profile.yaml",
    "xertica_profile": "xertica_profile.yaml",
}
_GAP_TIPO_MAP = {
    "volumetria": "volumetria_insuficiente",
    "volumetria insuficiente": "volumetria_insuficiente",
    "insuficiente": "volumetria_insuficiente",
    "ausencia": "ausencia_total",
    "ausência": "ausencia_total",
    "ausência total": "ausencia_total",
    "ausencia total": "ausencia_total",
    "gap total": "ausencia_total",
    "temporal": "temporal",
    "prazo": "temporal",
    "certificacao": "certificacao",
    "certificação": "certificacao",
    "certidao": "certidao",
    "certidão": "certidao",
}


def _pick(value: str, mapping: dict, valid: set, default: str) -> str:
    if not isinstance(value, str):
        return default
    # Pode vir como "atestados, contratos_com_atestado" — pega o primeiro token útil.
    tokens = [t.strip().lower() for t in value.replace(";", ",").split(",") if t.strip()]
    for t in tokens:
        if t in valid:
            return t
        if t in mapping:
            return mapping[t]
    # fallback: tenta o valor inteiro normalizado
    low = value.strip().lower()
    if low in mapping:
        return mapping[low]
    return default


def _normalize_enums(d: dict) -> dict:
    """Conserta drift de enums no JSON do Pro antes de validar contra Pydantic."""
    valid_fonte = {"atestado", "contrato", "deal_won", "certificado", "yaml"}
    valid_tabela = {"atestados", "contratos", "closed_deals_won", "certificados_xertica", "xertica_profile.yaml"}
    valid_gap = {"ausencia_total", "volumetria_insuficiente", "temporal", "certificacao", "certidao"}

    for r in d.get("requisitos_atendidos") or []:
        if "fonte" in r:
            r["fonte"] = _pick(r["fonte"], _FONTE_REQ_MAP, valid_fonte, "yaml")

    for e in d.get("evidencias_por_requisito") or []:
        if "fonte_tabela" in e:
            e["fonte_tabela"] = _pick(e["fonte_tabela"], _FONTE_TABELA_MAP, valid_tabela, "xertica_profile.yaml")
        if "tipo_evidencia" in e:
            e["tipo_evidencia"] = _pick(e["tipo_evidencia"], _FONTE_REQ_MAP, valid_fonte, "yaml")

    for g in d.get("gaps") or []:
        if "tipo" in g:
            g["tipo"] = _pick(g["tipo"], _GAP_TIPO_MAP, valid_gap, "ausencia_total")

    # status: padroniza maiúsculas
    if isinstance(d.get("status"), str):
        s = d["status"].strip().upper()
        if s in {"APTO", "APTO COM RESSALVAS", "INAPTO", "NO-GO", "NO GO"}:
            d["status"] = "NO-GO" if s == "NO GO" else s

    return d


def analisar(edital: EditalEstruturado, qualificador: QualificadorResult) -> ParecerFinal:
    """Produz o parecer final."""
    _init()
    model = GenerativeModel(MODEL_NAME, system_instruction=SYSTEM_PROMPT)

    payload = {
        "edital": edital.model_dump(),
        "qualificador": qualificador.model_dump(),
        "xertica_profile": _profile_resumido(),
    }
    payload_json = json.dumps(payload, ensure_ascii=False, default=str)
    if len(payload_json) > PAYLOAD_CHAR_LIMIT:
        log.warning(
            "analista.payload_truncado",
            extra={"original_chars": len(payload_json), "limit": PAYLOAD_CHAR_LIMIT},
        )
        payload_json = payload_json[:PAYLOAD_CHAR_LIMIT]

    t0 = time.time()
    response = model.generate_content(
        f"ANALISE o edital abaixo. Responda APENAS com o JSON do ParecerFinal.\n\n```json\n{payload_json}\n```",
        generation_config=GenerationConfig(temperature=0.2, response_mime_type="application/json"),
    )
    latency_ms = int((time.time() - t0) * 1000)
    raw = json.loads(response.text)
    raw = _normalize_enums(raw)
    parecer = ParecerFinal.model_validate(raw)

    # Preencher metadados se o LLM não preencheu
    if not parecer.edital_orgao:
        parecer.edital_orgao = edital.orgao
    if not parecer.edital_modalidade:
        parecer.edital_modalidade = edital.modalidade

    log.info(
        "analista.done",
        extra={
            "lici_adk": {
                "agent": "analista",
                "model": MODEL_NAME,
                "latency_ms": latency_ms,
                "status": parecer.status,
                "score": parecer.score_aderencia,
                "bloqueio": parecer.bloqueio_camada_1,
                "evidencias": len(parecer.evidencias_por_requisito),
                "gaps": len(parecer.gaps),
            }
        },
    )
    return parecer
