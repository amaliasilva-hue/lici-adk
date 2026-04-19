"""Pydantic schemas shared by all three agents.

Reflete o contrato de dados definido em ARCHITECTURE.md (§Agente 1/2/3).
Mudanças aqui são API pública entre os agentes — qualquer alteração exige
revisar o system prompt correspondente.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ════════════════════════════════════════════════════════════════════════
# EXTRATOR — output de `gemini-2.5-flash` lendo o PDF do edital
# ════════════════════════════════════════════════════════════════════════
class VolumetriaExigida(BaseModel):
    """Quantidade mínima de uma dimensão técnica exigida pelo edital.

    Exemplos:
      - {"contas_workspace", 400, "usuários"}   (TRE-TO)
      - {"vms_administradas", 50, "instâncias"} (BRB)
      - {"interacoes_chatbot", 20000, "mês"}    (COHAB)
      - {"ust_executadas_36m", 15000, "UST"}    (Celepar)
    """

    dimensao: str
    quantidade: float
    unidade: str


ModeloPrecificacao = Literal[
    "USN",
    "USNM",
    "UST",
    "USTc",
    "USTa",
    "licenca_fixa",
    "consumo_volumetria",
    "bolsa_horas",
    "tickets",
    "desconto_percentual",  # pregões de Ata: lance é % de desconto sobre tabela
    "preco_global",         # pregão por preço global do lote
    "preco_unitario",       # pregão por preço unitário item-a-item
]


class EditalEstruturado(BaseModel):
    """Saída do Agente 1 (Extrator). Contrato de entrada do Qualificador."""

    # --- Identificação básica ---
    objeto: str
    orgao: str
    uf: Optional[str] = None
    uasg: Optional[str] = None
    modalidade: Optional[str] = None
    data_encerramento: Optional[str] = None
    prazo_questionamento: Optional[str] = None
    duracao_contrato: Optional[str] = None
    valor_estimado: Optional[float] = None
    portal: Optional[str] = None

    # --- Requisitos técnicos e de habilitação ---
    requisitos_tecnicos: list[str] = Field(default_factory=list)
    requisitos_habilitacao: list[str] = Field(default_factory=list)
    garantia_contratual: Optional[str] = None
    nivel_parceria_exigido: Optional[str] = None
    certificacoes_corporativas_exigidas: list[str] = Field(default_factory=list)
    certificacoes_profissionais_exigidas: list[str] = Field(default_factory=list)
    volumetria_exigida: list[VolumetriaExigida] = Field(default_factory=list)

    # --- Modelo comercial ---
    modelo_precificacao: list[ModeloPrecificacao] = Field(default_factory=list)
    tabela_proporcionalidade_ust: Optional[dict[str, float]] = None
    nivel_sla_critico: Optional[str] = None
    penalidades_glosa_max_pct: Optional[float] = None

    # --- Flags de Go/No-Go (ARCHITECTURE.md §Agente 1) ---
    exclusividade_me_epp: bool = False
    vedacao_consorcio: bool = False
    subcontratacao_permitida: Optional[str] = None  # "livre" | "parcial" | "vedada"
    exige_poc_mvp: bool = False
    prazo_poc: Optional[str] = None
    modelo_inovacao_etec: bool = False
    restricao_temporal_experiencia_meses: Optional[int] = None
    localizacao_dados_exigida: Optional[str] = None
    dependencias_terceiros_identificadas: list[str] = Field(default_factory=list)
    strict_match_atestados: bool = False
    match_familia_permitido: bool = True  # default — edital genérico permite match por família

    # --- Keywords derivadas (o Qualificador usa como termos de busca) ---
    keywords_busca: list[str] = Field(default_factory=list)

    # --- Fase 4: Drive + Somador de Atestados ---
    id: Optional[str] = None  # UUID interno do edital (chave no cache Postgres)
    drive_folder_id: Optional[str] = None  # ID da pasta raiz do edital no Google Drive
    volume_exigido_principal: Optional[float] = None  # volume total exigido (mesma unidade da volumetria)


# ════════════════════════════════════════════════════════════════════════
# QUALIFICADOR — matches recuperados do BigQuery
# ════════════════════════════════════════════════════════════════════════
class AtestadoMatch(BaseModel):
    id: Optional[str] = None
    nomedaconta: Optional[str] = None
    objeto: Optional[str] = None
    resumodoatestado: Optional[str] = None
    familia: Optional[str] = None
    acelerador: Optional[str] = None
    horas: Optional[float] = None
    datadoatestado: Optional[str] = None
    linkdeacesso: Optional[str] = None
    nrodocontrato: Optional[str] = None
    keyword_hit: Optional[str] = None  # qual termo casou


class ContratoMatch(BaseModel):
    nomedaconta: Optional[str] = None
    objetodocontrato: Optional[str] = None
    resumodocontrato: Optional[str] = None
    detalhamentoservicos: Optional[str] = None
    aceleradores: Optional[str] = None
    statusdocontrato: Optional[str] = None
    valordocontrato: Optional[float] = None
    numerodocontrato: Optional[str] = None
    atestado_id: Optional[str] = None
    atestado_linkdeacesso: Optional[str] = None
    keyword_hit: Optional[str] = None


class DealMatch(BaseModel):
    conta: Optional[str] = None
    oportunidade: Optional[str] = None
    produtos: Optional[str] = None
    familia_produto: Optional[str] = None
    resumo_analise: Optional[str] = None
    fatores_sucesso: Optional[str] = None
    causa_raiz: Optional[str] = None  # só preenchido em deals_lost
    licoes_aprendidas: Optional[str] = None
    vertical_ia: Optional[str] = None
    gross: Optional[float] = None
    data_fechamento: Optional[str] = None


class CertificadoMatch(BaseModel):
    cert_id: Optional[str] = None
    certification: Optional[str] = None
    certification_subtype: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    expiration_date: Optional[str] = None


class QualificadorResult(BaseModel):
    """Saída do Agente 2 (Qualificador)."""

    atestados: list[AtestadoMatch] = Field(default_factory=list)
    contratos_com_atestado: list[ContratoMatch] = Field(default_factory=list)
    contratos_sem_atestado: list[ContratoMatch] = Field(default_factory=list)
    deals_won: list[DealMatch] = Field(default_factory=list)
    deals_lost: list[DealMatch] = Field(default_factory=list)
    certificados: list[CertificadoMatch] = Field(default_factory=list)
    queries_executadas: int = 0
    modo_busca: Literal["like", "strict", "familia"] = "like"


# ════════════════════════════════════════════════════════════════════════
# ANALISTA — parecer final
# ════════════════════════════════════════════════════════════════════════
StatusParecer = Literal["APTO", "APTO COM RESSALVAS", "INAPTO", "NO-GO"]


class RequisitoAtendido(BaseModel):
    requisito: str
    comprovacao: str  # "Atestado MPRS 2024 — IA Vertex"
    fonte: Literal["atestado", "contrato", "deal_won", "certificado", "yaml"]
    link: Optional[str] = None


class Evidencia(BaseModel):
    """Evidência auditável por requisito — transforma parecer em artefato contestável."""

    requisito: str
    fonte_tabela: Literal[
        "atestados", "contratos", "closed_deals_won", "certificados_xertica", "xertica_profile.yaml"
    ]
    fonte_id: Optional[str] = None  # id do registro na tabela ou caminho no YAML
    trecho_literal: str  # trecho do resumodoatestado/resumodocontrato que comprova
    tipo_evidencia: Literal["atestado", "contrato", "deal_won", "certificado", "yaml"]
    confianca: float = Field(ge=0.0, le=1.0)  # 0-1 (self-reported pelo LLM)


class GapIdentificado(BaseModel):
    requisito: str
    tipo: Literal["ausencia_total", "volumetria_insuficiente", "temporal", "certificacao", "certidao"]
    delta_numerico: Optional[float] = None  # ex: 280 contas faltando
    recomendacao: str


class ParecerComercial(BaseModel):
    """Saída do Agente 3 (Analista Comercial).

    `score_aderencia` é `None` quando a Camada 1 de bloqueadores duros ativa
    (ver ARCHITECTURE.md §Lógica de Decisão). Nesses casos `status` é `INAPTO` ou
    `NO-GO` e o score não é calculado — evita parecer do tipo "82/100 mas INAPTO".
    """

    score_aderencia: Optional[int] = Field(default=None, ge=0, le=100)
    status: StatusParecer
    bloqueio_camada_1: Optional[str] = None  # preenchido quando short-circuit ativa
    requisitos_atendidos: list[RequisitoAtendido] = Field(default_factory=list)
    evidencias_por_requisito: list[Evidencia] = Field(default_factory=list)
    gaps: list[GapIdentificado] = Field(default_factory=list)
    estrategia: str
    alertas: list[str] = Field(default_factory=list)
    campos_trello: dict = Field(default_factory=dict)

    # Metadados de rastreio
    edital_orgao: Optional[str] = None
    edital_modalidade: Optional[str] = None
    trace_id: Optional[str] = None


# Alias de retrocompatibilidade — remove na Fase 3
ParecerFinal = ParecerComercial
