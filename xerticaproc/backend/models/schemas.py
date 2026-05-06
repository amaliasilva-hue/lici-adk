"""Schemas Pydantic — xerticaproc.

Modelos de dados para toda a plataforma: entrada, estado dos agentes,
saída estruturada, mapa de preços e documentos gerados.
"""
from __future__ import annotations

import enum
from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator


# ─────────────────────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────────────────────

class StatusContratacao(str, enum.Enum):
    RASCUNHO = "rascunho"
    DEMANDA = "demanda"
    MERCADO = "mercado"
    PRECOS = "precos"
    ETP = "etp"
    TR = "tr"
    REVISAO = "revisao"
    APROVADO = "aprovado"
    ARQUIVADO = "arquivado"


class TipoDocumento(str, enum.Enum):
    DFD = "DFD"
    ETP = "ETP"
    TR = "TR"
    MAPA_PRECOS = "mapa_precos"
    MATRIZ_RISCOS = "matriz_riscos"
    MATRIZ_ALTERNATIVAS = "matriz_alternativas"
    MEMORIA_CALCULO = "memoria_calculo"
    RELATORIO_EVIDENCIAS = "relatorio_evidencias"
    CHECKLIST_JURIDICO = "checklist_juridico"


class StatusAprovacao(str, enum.Enum):
    PENDENTE = "pendente"
    APROVADO = "aprovado"
    REJEITADO = "rejeitado"
    REVISAO_SOLICITADA = "revisao_solicitada"


class TipoFonteMercado(str, enum.Enum):
    PNCP = "pncp"
    COMPRAS_GOV = "compras_gov"
    PAINEL_PRECOS = "painel_precos"
    ARP = "arp"
    CONTRATO = "contrato"
    COTACAO = "cotacao"
    FABRICANTE = "fabricante"
    HISTORICO_INTERNO = "historico_interno"
    PROPOSTA_COMERCIAL = "proposta_comercial"


class NivelComparabilidade(str, enum.Enum):
    ALTA = "alta"       # score >= 0.70
    MEDIA = "media"     # score >= 0.40
    BAIXA = "baixa"     # score >= 0.20
    DESCARTADA = "descartada"  # score < 0.20


class ModalidadeContratacao(str, enum.Enum):
    PREGAO_ELETRONICO = "pregao_eletronico"
    CONCORRENCIA = "concorrencia"
    DISPENSA = "dispensa"
    INEXIGIBILIDADE = "inexigibilidade"
    ADESAO_ATA = "adesao_ata"
    ARP = "arp"


class NivelRisco(str, enum.Enum):
    ALTO = "alto"
    MEDIO = "medio"
    BAIXO = "baixo"


class UnidadeMedida(str, enum.Enum):
    USUARIO = "usuario"
    LICENCA = "licenca"
    UST = "ust"
    HORA_TECNICA = "hora_tecnica"
    PONTO_FUNCAO = "ponto_funcao"
    CREDITO_NUVEM = "credito_nuvem"
    PACOTE = "pacote"
    ITEM = "item"
    SERVICO = "servico"
    MES = "mes"
    ANO = "ano"
    OUTRO = "outro"


# ─────────────────────────────────────────────────────────────────────────────
# Modelos de Entrada
# ─────────────────────────────────────────────────────────────────────────────

class EntradaDemanda(BaseModel):
    """Entrada inicial do usuário para criar uma contratação."""
    orgao: str = Field(..., description="Nome do órgão contratante")
    uasg: str | None = Field(None, description="Código UASG")
    unidade_demandante: str = Field(..., description="Unidade que demanda a contratação")
    objeto_da_contratacao: str = Field(..., description="Descrição do objeto a contratar")
    problema_publico: str = Field(..., description="Problema público a ser resolvido")
    objetivo: str = Field(..., description="Objetivo da contratação")
    prazo_estimado_meses: int = Field(..., ge=1, le=120, description="Prazo do contrato em meses")
    orcamento_estimado: float | None = Field(None, ge=0, description="Orçamento estimado em R$")
    pca_id: str | None = Field(None, description="ID no PCA/PDTIC se existir")
    pdtic_alinhado: bool = Field(False, description="Alinhado ao PDTIC?")
    contrato_atual: str | None = Field(None, description="Contrato vigente se houver")
    ha_dados_pessoais: bool = Field(False, description="Envolve dados pessoais (LGPD)?")
    ha_integracao_sistemas: bool = Field(False, description="Requer integração com sistemas internos?")
    restricoes: list[str] = Field(default_factory=list, description="Restrições técnicas ou legais")
    premissas: list[str] = Field(default_factory=list)
    dependencias: list[str] = Field(default_factory=list)
    requisitos_tecnicos_iniciais: str | None = Field(None, description="Requisitos técnicos preliminares")
    quantidades: dict[str, Any] = Field(default_factory=dict, description="Quantidades estimadas por item")
    responsavel: str = Field(..., description="Email do responsável pela contratação")


class FiltrosPesquisaPrecos(BaseModel):
    """Filtros para pesquisa de preços no pipeline."""
    objeto: str
    palavras_chave: list[str] = Field(default_factory=list)
    catmat: str | None = None
    catser: str | None = None
    fabricante: str | None = None
    unidade_medida: UnidadeMedida | None = None
    vigencia_meses: int | None = None
    quantidade_referencia: float | None = None
    orgaos_similares: list[str] = Field(default_factory=list)
    data_minima: date | None = None
    data_maxima: date | None = None
    excluir_fontes: list[TipoFonteMercado] = Field(default_factory=list)
    limite_resultados: int = Field(50, ge=1, le=500)


# ─────────────────────────────────────────────────────────────────────────────
# Outputs dos Agentes
# ─────────────────────────────────────────────────────────────────────────────

class DemandaEstruturada(BaseModel):
    """Output do Agente 1 — Demanda/DFD."""
    problema_publico: str
    objetivo_contratacao: str
    unidade_demandante: str
    resultados_esperados: list[str]
    restricoes: list[str]
    premissas: list[str]
    dependencias: list[str]
    alinhamento_pca: str | None = None
    alinhamento_pdtic: str | None = None
    perguntas_pendentes: list[str] = Field(default_factory=list)
    lacunas_identificadas: list[str] = Field(default_factory=list)
    diagnostico: str


class ItemContratavel(BaseModel):
    """Item identificado pelo Agente de Decomposição."""
    nome: str
    descricao: str
    tipo: str  # licenca|servico|suporte|treinamento|credito|integracao|governança
    unidade_medida: UnidadeMedida
    quantidade_estimada: float | None = None
    obrigatorio: bool = True
    alerta_direcionamento: str | None = None
    catmat: str | None = None
    catser: str | None = None

    @field_validator("unidade_medida", mode="before")
    @classmethod
    def coerce_unidade_medida(cls, v: object) -> object:
        """Coerce valores desconhecidos de unidade_medida para 'outro'."""
        valid = {m.value for m in UnidadeMedida}
        if isinstance(v, str) and v not in valid:
            return UnidadeMedida.OUTRO
        return v


class ObjetoDecomposto(BaseModel):
    """Output do Agente 2 — Decomposição do Objeto."""
    objeto_consolidado: str
    itens: list[ItemContratavel]
    modalidade_sugerida: ModalidadeContratacao
    alertas: list[str] = Field(default_factory=list)
    risco_direcionamento: NivelRisco = NivelRisco.BAIXO
    justificativa_modalidade: str


class AlternativaMercado(BaseModel):
    """Uma alternativa de solução para o mercado."""
    nome: str  # ex: "Solução A — plataforma corporativa integrada"
    descricao: str
    vantagens: list[str]
    desvantagens: list[str]
    riscos: list[str]
    custo_estimado_range: str  # ex: "R$ 500k – R$ 1,2M"
    fonte_estimativa: str | None = None
    recomendada: bool = False


class MatrizAlternativas(BaseModel):
    """Output do Agente 3 — Pesquisa de Mercado."""
    alternativas: list[AlternativaMercado]
    alternativa_escolhida: str  # nome da alternativa recomendada
    justificativa_escolha: str
    fontes_consultadas: list[str]
    pontos_atencao: list[str]


class ItemPreco(BaseModel):
    """Item de preço coletado e normalizado de uma fonte."""
    id: UUID = Field(default_factory=uuid4)
    fonte_tipo: TipoFonteMercado
    orgao: str | None = None
    numero_documento: str | None = None
    url: str | None = None
    data_publicacao: date | None = None
    descricao_original: str
    descricao_normalizada: str
    fabricante: str | None = None
    sku: str | None = None
    catmat: str | None = None
    catser: str | None = None
    unidade_original: str
    unidade_normalizada: UnidadeMedida
    quantidade: float
    valor_unitario: float
    valor_total: float | None = None
    vigencia_meses: int | None = None
    valor_mensal_por_unidade: float | None = None  # normalizado
    inclui_suporte: bool = False
    inclui_implantacao: bool = False
    inclui_treinamento: bool = False
    score_comparabilidade: float = Field(0.0, ge=0.0, le=1.0)
    nivel_comparabilidade: NivelComparabilidade = NivelComparabilidade.DESCARTADA
    score_detalhes: dict[str, Any] = Field(default_factory=dict)
    motivo_descarte: str | None = None


class MapaPrecos(BaseModel):
    """Output do Agente 4 — Mapa de Preços completo."""
    contratacao_id: UUID
    objeto: str
    unidade_medida: UnidadeMedida
    vigencia_meses: int
    quantidade_referencia: float

    referencias_aceitas: list[ItemPreco]      # score >= 0.20
    referencias_descartadas: list[ItemPreco]   # score < 0.20

    preco_medio: float
    preco_mediana: float
    menor_preco: float
    maior_preco: float
    preco_referencia_recomendado: float
    metodo_calculo: str  # ex: "mediana das 5 referências de alta comparabilidade"

    memoria_normalizacao: str  # texto explicando cada ajuste feito
    riscos_estimativa: list[str]
    advertencias: list[str]
    total_fontes_consultadas: int
    data_pesquisa: datetime = Field(default_factory=datetime.utcnow)


class RequisitosTecnicos(BaseModel):
    """Output do Agente 5 — Requisitos Técnicos."""
    requisitos_funcionais: list[str]
    requisitos_nao_funcionais: list[str]
    requisitos_seguranca: list[str]
    requisitos_integracao: list[str]
    requisitos_suporte: list[str]
    niveis_servico: dict[str, str]  # ex: {"disponibilidade": "99.5%", "RTO": "4h"}
    criterios_aceite: list[str]
    requisitos_lgpd: list[str]
    alertas_especificacao_excessiva: list[str]


class ItemChecklistJuridico(BaseModel):
    item: str
    conforme: bool
    observacao: str | None = None
    artigo_referencia: str | None = None


class ValidacaoJuridica(BaseModel):
    """Output do Agente 6 — Jurídico/Normativo."""
    checklist: list[ItemChecklistJuridico]
    aderente_lei_14133: bool
    aderente_in_94_2022: bool
    aderente_lgpd: bool
    pendencias: list[str]
    alertas_impugnacao: list[str]
    recomendacoes: list[str]
    referencias_normativas: list[str]


class Risco(BaseModel):
    descricao: str
    categoria: str  # preco|fornecedor|juridico|tecnico|lgpd|impugnacao|operacional
    probabilidade: NivelRisco
    impacto: NivelRisco
    score_risco: int  # 1-9 (prob × impacto: 1=baixa×baixo, 9=alta×alto)
    mitigacao: str
    responsavel: str | None = None


class MatrizRiscos(BaseModel):
    """Output do Agente 7 — Riscos."""
    riscos: list[Risco]
    risco_mais_critico: str
    aprovado_para_prosseguir: bool
    condicoes_para_prosseguir: list[str]


class PendenciaRevisao(BaseModel):
    tipo: str  # evidencia_faltante|preco_sem_fonte|requisito_excessivo|inconsistencia
    descricao: str
    localizacao: str  # seção do documento
    critica: bool = False  # se True, bloqueia aprovação


class RelatorioRevisao(BaseModel):
    """Output do Agente 9 — Revisor/Auditor."""
    documento_id: UUID
    aprovado: bool
    pendencias: list[PendenciaRevisao]
    pendencias_criticas: int
    resumo: str
    recomendacoes: list[str]
    checklist_etp_completo: bool
    checklist_tr_coerente: bool
    todas_afirmacoes_tem_evidencia: bool
    todos_precos_tem_fonte: bool
    criterios_aceite_mensuraveis: bool
    sem_risco_especificacao_restritiva: bool


# ─────────────────────────────────────────────────────────────────────────────
# Evidence Bundle
# ─────────────────────────────────────────────────────────────────────────────

class EvidenceBundle(BaseModel):
    """Pacote completo de evidências para geração de ETP/TR.
    
    O Agente Redator SÓ pode usar o que está aqui. Nada inventado.
    """
    contratacao_id: UUID
    etapa: str

    # Outputs dos agentes anteriores
    demanda: DemandaEstruturada | None = None
    objeto_decomposto: ObjetoDecomposto | None = None
    matriz_alternativas: MatrizAlternativas | None = None
    mapa_precos: MapaPrecos | None = None
    requisitos_tecnicos: RequisitosTecnicos | None = None
    validacao_juridica: ValidacaoJuridica | None = None
    matriz_riscos: MatrizRiscos | None = None

    # Metadados de rastreabilidade
    fontes_usadas: list[str] = Field(default_factory=list)
    prompt_execucoes_ids: list[UUID] = Field(default_factory=list)
    criado_em: datetime = Field(default_factory=datetime.utcnow)

    @property
    def completo_para_etp(self) -> bool:
        return all([
            self.demanda,
            self.objeto_decomposto,
            self.matriz_alternativas,
            self.mapa_precos,
            self.requisitos_tecnicos,
            self.matriz_riscos,
        ])

    @property
    def completo_para_tr(self) -> bool:
        return self.completo_para_etp and bool(self.validacao_juridica)


# ─────────────────────────────────────────────────────────────────────────────
# Documento Gerado
# ─────────────────────────────────────────────────────────────────────────────

class DocumentoGerado(BaseModel):
    """Resultado final do Agente Redator."""
    id: UUID = Field(default_factory=uuid4)
    contratacao_id: UUID
    tipo: TipoDocumento
    versao: int = 1
    conteudo_markdown: str
    status_aprovacao: StatusAprovacao = StatusAprovacao.PENDENTE
    evidence_bundle_id: UUID
    afirmacoes_sem_evidencia: list[str] = Field(default_factory=list)
    criado_por_agente: str = "agente_redator"
    criado_em: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# Plano de Pesquisa (output do agente de planejamento inicial)
# ─────────────────────────────────────────────────────────────────────────────

class PlanoConsulta(BaseModel):
    """Output do agente que planeja a busca de preços antes de executar.
    
    Campos correspondentes à entrada especificada:
    {objeto_da_contratacao}{requisitos_tecnicos}{prazo_estimado}{quantidades}
    {orgao}{restricoes}
    """
    objeto_da_contratacao: str
    requisitos_tecnicos: str | None = None
    prazo_estimado_meses: int | None = None
    quantidades: dict[str, Any] = Field(default_factory=dict)
    orgao: str | None = None
    restricoes: list[str] = Field(default_factory=list)

    # Saídas do planejamento
    queries_sugeridas: list[str] = Field(..., description="Queries para PNCP e Compras.gov")
    filtros: dict[str, Any] = Field(default_factory=dict, description="Filtros a aplicar")
    entidades_a_extrair: list[str] = Field(..., description="Campos a extrair dos documentos")
    riscos_de_comparacao: list[str] = Field(default_factory=list)
    campos_mapa_precos: list[str] = Field(..., description="Campos necessários para o mapa de preços")

    # O agente não decide — monta o plano e entrega para execução humana/automática
    confianca: float = Field(..., ge=0.0, le=1.0)
    pendencias_antes_de_buscar: list[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Respostas da API
# ─────────────────────────────────────────────────────────────────────────────

class ContratacaoCreated(BaseModel):
    contratacao_id: UUID
    status: StatusContratacao
    mensagem: str


class EtapaIniciada(BaseModel):
    contratacao_id: UUID
    etapa: str
    job_id: str
    status: str = "queued"


class StatusEtapa(BaseModel):
    contratacao_id: UUID
    etapa: str
    status: str  # queued|running|done|failed
    agente_atual: str | None = None
    resultado: dict[str, Any] | None = None
    erro: str | None = None
    progresso_pct: int = 0
