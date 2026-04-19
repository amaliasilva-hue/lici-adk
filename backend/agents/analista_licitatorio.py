"""Agente 5 — Analista Licitatório (Fase 5).

Recebe EditalEstruturado (output do Extrator) e produz RelatorioLicitatorio —
6 blocos de análise jurídica: FichaProcesso, AtestadoAnalise, RiscoJuridico,
DocumentosProtocolo, ResumoExecutivo, KitHabilitacao.

Knowledge (in-context):
  - Lei 14.133/2021 completa (backend/knowledge/lei_14133.txt — ~292 KB)
  - Súmulas TCU curadas (backend/knowledge/tcu_sumulas.yaml)
  - Dados empresa Xertica (backend/xertica_profile.yaml, bloco empresa)

Modelo: gemini-2.5-pro (1M ctx — lei + súmulas + edital cabem folgados).

Ref: architecture2.md §6.1 e §6.5.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import textwrap
import time
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import vertexai
import yaml
from vertexai.generative_models import GenerationConfig, GenerativeModel

from backend.models.schemas import (
    AtestadoAnalise,
    AtestadoRecomendado,
    BidConfig,
    CertidaoChecklist,
    DocumentoProtocolo,
    EditalEstruturado,
    FichaProcesso,
    KitHabilitacao,
    PrazosCalculados,
    RelatorioLicitatorio,
    ResumoExecutivo,
    RiscoJuridico,
)

log = logging.getLogger("lici_adk.analista_licitatorio")

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
LOCATION = os.getenv("LICI_VERTEX_LOCATION", "us-central1")
MODEL_NAME = os.getenv("LICI_JURIDICO_MODEL", "gemini-2.5-pro")

_KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
_PROFILE_PATH = Path(__file__).resolve().parent.parent / "xertica_profile.yaml"

_initialized = False


def _init() -> None:
    global _initialized
    if not _initialized:
        vertexai.init(project=PROJECT, location=LOCATION)
        _initialized = True


# ── Knowledge carregado uma vez ──────────────────────────────────────────────

@lru_cache(maxsize=1)
def _lei_14133() -> str:
    path = _KNOWLEDGE_DIR / "lei_14133.txt"
    if not path.exists():
        log.warning("lei_14133.txt não encontrada em %s", path)
        return "[Lei 14.133/2021 não carregada — arquivo ausente]"
    return path.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def _tcu_sumulas_raw() -> str:
    path = _KNOWLEDGE_DIR / "tcu_sumulas.yaml"
    if not path.exists():
        log.warning("tcu_sumulas.yaml não encontrado em %s", path)
        return ""
    return path.read_text(encoding="utf-8")


def _knowledge_version() -> str:
    """SHA-256 dos arquivos de knowledge (lei + súmulas)."""
    h = hashlib.sha256()
    h.update(_lei_14133().encode())
    h.update(_tcu_sumulas_raw().encode())
    return h.hexdigest()[:16]  # primeiros 16 chars — suficiente para tracking


@lru_cache(maxsize=1)
def _empresa_yaml() -> dict:
    """Bloco empresa do xertica_profile.yaml."""
    if not _PROFILE_PATH.exists():
        return {}
    full = yaml.safe_load(_PROFILE_PATH.read_text())
    return full.get("empresa", {})


# ── Cálculo de prazos (Python, não LLM) ──────────────────────────────────────

_DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%d/%m/%Y %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"]

# MVP: usa dias corridos como conservador (sem calendário de feriados).
# Esclarecimento: −7 dias corridos ≈ −5 dias úteis (art. 164 §1º)
# Impugnação: −4 dias corridos ≈ −3 dias úteis (art. 164 caput)
_DIAS_CORRIDOS_ESCLARECIMENTO = 7
_DIAS_CORRIDOS_IMPUGNACAO = 4


def _calcular_prazos(data_encerramento_str: str | None) -> PrazosCalculados:
    if not data_encerramento_str:
        return PrazosCalculados()
    dt: datetime | None = None
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(data_encerramento_str.strip()[:19], fmt)
            break
        except ValueError:
            continue
    if dt is None:
        return PrazosCalculados()
    esc = (dt - timedelta(days=_DIAS_CORRIDOS_ESCLARECIMENTO)).strftime("%d/%m/%Y")
    imp = (dt - timedelta(days=_DIAS_CORRIDOS_IMPUGNACAO)).strftime("%d/%m/%Y")
    return PrazosCalculados(
        data_limite_esclarecimento=esc,
        data_limite_impugnacao=imp,
    )


# ── System prompt ────────────────────────────────────────────────────────────

_SYSTEM_PROMPT_TEMPLATE = textwrap.dedent("""\
Você é o Analista Licitatório do x-lici — especialista em Lei 14.133/2021 e
jurisprudência do TCU, com foco em licitações de TI (Google Workspace, Google Cloud,
serviços gerenciados, IA generativa, UST, bolsa de horas).

Sua empresa: Xertica Brasil Ltda
  CNPJ: {cnpj}
  Razão Social: {razao_social}
  Representante: {representante_legal} ({cargo_representante})
  CPF: {cpf_representante}
  Endereço: {endereco}

══════════════════════════════════════════════════════════════════
LEI 14.133/2021 — TEXTO INTEGRAL (use como fonte primária de verdade)
══════════════════════════════════════════════════════════════════
{lei_14133}

══════════════════════════════════════════════════════════════════
SÚMULAS E POSICIONAMENTOS TCU CURADOS
══════════════════════════════════════════════════════════════════
{tcu_sumulas}

══════════════════════════════════════════════════════════════════
REGRAS OBRIGATÓRIAS
══════════════════════════════════════════════════════════════════
1. NUNCA invente artigos ou acórdãos. Cite apenas o que está no texto da lei acima.
2. Quando uma súmula TCU for aplicável, cite seu ID (ex: TCU-S-001) em base_legal.
3. Distingua ESCLARECIMENTO de IMPUGNAÇÃO:
   - ESCLARECIMENTO: dúvida interpretativa — prazo art. 164 §1º (−5 dias úteis)
   - IMPUGNAÇÃO: cláusula ilegal ou restritiva — prazo art. 164 caput (−3 dias úteis)
4. Use os prazos calculados fornecidos pelo sistema para o campo prazo_limite.
5. texto_formal deve ser formal e completo:
   - Cabeçalho: "À Autoridade Competente / Ao Pregoeiro"
   - Identificação da empresa (use dados acima)
   - Corpo: descrição do problema, fundamentação legal, transcrição da cláusula
   - Pedido formal claro (anulação da cláusula / prestação do esclarecimento)
   - Encerramento + cidade/data (use "São Paulo, [data]")
6. KitHabilitacao.certidoes_checklist deve incluir SEMPRE as 5 certidões padrão:
   - CND Federal (Receita Federal + PGFN), obrigatorio=true, validade_dias=180
   - CND FGTS (Caixa Econômica Federal), obrigatorio=true, validade_dias=30
   - CND Estadual (SEFAZ do estado do órgão), obrigatorio=true, validade_dias=90
   - CNDT (TST — débitos trabalhistas), obrigatorio=true, validade_dias=180
   - CND Municipal (domicílio fiscal da empresa), obrigatorio=true, validade_dias=90
   Adicione outras certidões se o edital as exigir explicitamente.
7. score_conformidade: 100 = totalmente conforme; desconta conforme gravidade.
   IRREGULAR: −25 a −40 por cláusula; RESTRITIVO: −10 a −20 por cláusula.
8. Retorne SOMENTE JSON válido, sem texto antes ou depois do objeto JSON.

══════════════════════════════════════════════════════════════════
ESQUEMA JSON DE SAÍDA (copie a estrutura exatamente)
══════════════════════════════════════════════════════════════════
{{
  "ficha_processo": {{
    "orgao": "string",
    "uf": "string|null",
    "objeto": "string",
    "modalidade": "string|null",
    "valor_estimado": number|null,
    "data_encerramento": "string|null",
    "duracao_contrato": "string|null",
    "portal": "string|null",
    "resumo_executivo": "string — 2-3 frases descrevendo o edital",
    "prazos_calculados": {{
      "data_limite_esclarecimento": "DD/MM/AAAA",
      "data_limite_impugnacao": "DD/MM/AAAA",
      "nota": "string"
    }}
  }},
  "atestado_analise": {{
    "permite_somatorio": true|false,
    "exige_parcela_maior_relevancia": true|false,
    "percentual_minimo": number|null,
    "restricao_temporal": true|false,
    "restricao_local": true|false,
    "conformidade": "CONFORME"|"IRREGULAR"|"RESTRITIVO"|"INCONCLUSIVO",
    "fundamentacao": "string — cite artigos literais e IDs de súmulas TCU",
    "alertas": ["string"]
  }},
  "risco_juridico": {{
    "indicadores_economicos": ["string"],
    "clausulas_restritivas": ["string"],
    "riscos": ["string"],
    "nivel_risco": "BAIXO"|"MEDIO"|"ALTO"|"CRITICO"
  }},
  "documentos_protocolo": [
    {{
      "tipo": "ESCLARECIMENTO"|"IMPUGNACAO",
      "topico": "string",
      "numero_clausula": "string|null",
      "clausula_questionada": "string",
      "prazo_limite": "DD/MM/AAAA|null",
      "destinatario": "Pregoeiro"|"Autoridade competente",
      "texto_formal": "string — texto completo pronto para protocolar",
      "base_legal": ["Lei 14.133/2021, art. X", "TCU-S-XXX"]
    }}
  ],
  "resumo_executivo": {{
    "conformidade_geral": "CONFORME"|"IRREGULAR"|"RESTRITIVO"|"INCONCLUSIVO",
    "score_conformidade": 0-100,
    "pontos_criticos": ["string"],
    "recomendacao": "participar"|"impugnar antes"|"aguardar retificação",
    "proximos_passos": ["string"]
  }},
  "kit_habilitacao": {{
    "atestados_recomendados": [
      {{
        "drive_file_id": "string|null",
        "drive_file_name": "string|null",
        "contratante": "string|null",
        "volume_contribuido": number|null,
        "satisfaz_parcela_maior_relevancia": true|false
      }}
    ],
    "declaracoes_necessarias": ["string — nome da declaração exigida"],
    "certidoes_checklist": [
      {{"nome": "string", "obrigatorio": true|false, "validade_dias": number}}
    ],
    "gap_habilitacao": "string — o que falta antes da sessão"
  }}
}}
""")


def _build_system_prompt() -> str:
    empresa = _empresa_yaml()
    lei = _lei_14133()
    sumulas_text = _tcu_sumulas_raw() or "(súmulas TCU não carregadas — prosseguir sem elas)"
    return _SYSTEM_PROMPT_TEMPLATE.format(
        cnpj=empresa.get("cnpj", "N/D"),
        razao_social=empresa.get("razao_social", "Xertica Brasil Ltda"),
        representante_legal=empresa.get("representante_legal", "N/D"),
        cargo_representante=empresa.get("cargo_representante", "Representante Legal"),
        cpf_representante=empresa.get("cpf_representante", "N/D"),
        endereco=empresa.get("endereco", "N/D"),
        lei_14133=lei,
        tcu_sumulas=sumulas_text,
    )


# ── User message (edital + context) ─────────────────────────────────────────

def _build_user_message(
    edital: EditalEstruturado,
    prazos: PrazosCalculados,
    *,
    bid_config: BidConfig | None = None,
    somatorio_drive: dict | None = None,
) -> str:
    partes: list[str] = [
        "Analise o edital abaixo e retorne o relatório jurídico no formato JSON especificado.",
        "",
        f"== PRAZOS CALCULADOS PELO SISTEMA (use estes valores) ==",
        f"Data limite para ESCLARECIMENTO: {prazos.data_limite_esclarecimento or 'não calculado'}",
        f"Data limite para IMPUGNAÇÃO:     {prazos.data_limite_impugnacao or 'não calculado'}",
        "",
        "== EDITAL ESTRUTURADO (output do Extrator) ==",
        json.dumps(edital.model_dump(exclude_none=True), ensure_ascii=False, indent=2),
    ]

    if somatorio_drive:
        partes += [
            "",
            "== SOMATÓRIO DE ATESTADOS DO DRIVE (use para KitHabilitacao.atestados_recomendados) ==",
            json.dumps(somatorio_drive, ensure_ascii=False, indent=2),
        ]
    else:
        partes += [
            "",
            "== SOMATÓRIO DE ATESTADOS: não disponível ainda. ==",
            "KitHabilitacao.atestados_recomendados deve ser array vazio [].",
            "KitHabilitacao.gap_habilitacao deve mencionar que somatório Drive ainda não foi processado.",
        ]

    if bid_config:
        if bid_config.custom_instrucoes:
            partes += ["", "== INSTRUÇÕES CUSTOMIZADAS DO USUÁRIO ==", bid_config.custom_instrucoes]
        if bid_config.focar_clausulas:
            partes += ["", f"FOCAR NAS CLÁUSULAS: {', '.join(bid_config.focar_clausulas)}"]
        if bid_config.ignorar_clausulas:
            partes += ["", f"IGNORAR AS CLÁUSULAS: {', '.join(bid_config.ignorar_clausulas)}"]

    return "\n".join(partes)


# ── Post-processamento ───────────────────────────────────────────────────────

_CERTIDOES_PADRAO: list[CertidaoChecklist] = [
    CertidaoChecklist(nome="CND Federal (Receita Federal + PGFN)", obrigatorio=True, validade_dias=180),
    CertidaoChecklist(nome="CND FGTS (Caixa Econômica Federal)", obrigatorio=True, validade_dias=30),
    CertidaoChecklist(nome="CND Estadual (SEFAZ do estado do órgão)", obrigatorio=True, validade_dias=90),
    CertidaoChecklist(nome="CNDT (TST — débitos trabalhistas)", obrigatorio=True, validade_dias=180),
    CertidaoChecklist(nome="CND Municipal (domicílio fiscal da empresa)", obrigatorio=True, validade_dias=90),
]


def _ensure_certidoes(kit: KitHabilitacao) -> KitHabilitacao:
    """Garante que as 5 certidões padrão estejam sempre no checklist."""
    nomes_existentes = {c.nome.lower() for c in kit.certidoes_checklist}
    adicionais = [c for c in _CERTIDOES_PADRAO if c.nome.lower() not in nomes_existentes]
    return kit.model_copy(update={"certidoes_checklist": kit.certidoes_checklist + adicionais})


def _override_prazos(
    relatorio: RelatorioLicitatorio,
    prazos: PrazosCalculados,
) -> RelatorioLicitatorio:
    """Substitui prazos_calculados do LLM pelos calculados em Python (mais confiável)."""
    fp = relatorio.ficha_processo.model_copy(update={"prazos_calculados": prazos})

    docs_atualizados: list[DocumentoProtocolo] = []
    for doc in relatorio.documentos_protocolo:
        if doc.tipo == "ESCLARECIMENTO" and prazos.data_limite_esclarecimento:
            doc = doc.model_copy(update={"prazo_limite": prazos.data_limite_esclarecimento})
        elif doc.tipo == "IMPUGNACAO" and prazos.data_limite_impugnacao:
            doc = doc.model_copy(update={"prazo_limite": prazos.data_limite_impugnacao})
        docs_atualizados.append(doc)

    return relatorio.model_copy(
        update={"ficha_processo": fp, "documentos_protocolo": docs_atualizados}
    )


# ── Ponto de entrada público ─────────────────────────────────────────────────

def analisar_juridico(
    edital: EditalEstruturado,
    *,
    bid_config: BidConfig | None = None,
    somatorio_drive: dict | None = None,
    trace_id: str | None = None,
) -> RelatorioLicitatorio:
    """Analisa um edital juridicamente e retorna RelatorioLicitatorio (6 blocos).

    Args:
        edital: Saída do Extrator (EditalEstruturado).
        bid_config: Configuração customizável por usuário (opcional).
        somatorio_drive: Output do SomadorAgent, dict serializado (opcional).
        trace_id: UUID de rastreio para logs.

    Returns:
        RelatorioLicitatorio com FichaProcesso, AtestadoAnalise, RiscoJuridico,
        DocumentosProtocolo, ResumoExecutivo e KitHabilitacao.
    """
    _init()
    t0 = time.time()
    kv = _knowledge_version()
    log.info(
        "analista_licitatorio.start",
        extra={"lici_adk": {"trace_id": trace_id, "orgao": edital.orgao, "knowledge_version": kv}},
    )

    # 1. Prazos calculados em Python (não delegado ao LLM)
    prazos = _calcular_prazos(edital.data_encerramento)

    # 2. Montar prompt
    system_prompt = _build_system_prompt()
    user_message = _build_user_message(
        edital, prazos, bid_config=bid_config, somatorio_drive=somatorio_drive
    )

    # 3. Chamar Gemini 2.5 Pro
    model = GenerativeModel(
        MODEL_NAME,
        system_instruction=system_prompt,
        generation_config=GenerationConfig(
            temperature=0.1,
            max_output_tokens=8192,
            response_mime_type="application/json",
        ),
    )

    raw_response = model.generate_content(user_message)
    raw_text = raw_response.text.strip()

    # 4. Parse do JSON
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError:
        # Fallback: tenta extrair bloco JSON do texto (às vezes o modelo insere markdown)
        import re
        match = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if match:
            data = json.loads(match.group())
        else:
            raise ValueError(f"Analista Licitatório não retornou JSON válido. trace_id={trace_id}")

    # 5. Validar com Pydantic
    relatorio = RelatorioLicitatorio.model_validate(data)

    # 6. Pós-processamento: sobrescreve prazos com valores Python + garante certidões padrão
    relatorio = _override_prazos(relatorio, prazos)
    kit_completo = _ensure_certidoes(relatorio.kit_habilitacao)
    relatorio = relatorio.model_copy(
        update={
            "kit_habilitacao": kit_completo,
            "trace_id": trace_id,
            "knowledge_version": kv,
            "pipeline_ms": int((time.time() - t0) * 1000),
        }
    )

    log.info(
        "analista_licitatorio.done",
        extra={
            "lici_adk": {
                "trace_id": trace_id,
                "conformidade": relatorio.resumo_executivo.conformidade_geral,
                "score": relatorio.resumo_executivo.score_conformidade,
                "nivel_risco": relatorio.risco_juridico.nivel_risco,
                "docs_protocolo": len(relatorio.documentos_protocolo),
                "pipeline_ms": relatorio.pipeline_ms,
                "knowledge_version": kv,
            }
        },
    )
    return relatorio
