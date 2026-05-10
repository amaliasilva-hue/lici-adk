"""Copilot schemas — conversational layer.

Schemas usados pelo ConversationOrchestrator, ChecklistEngine e ReadinessAgent.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


# ─────────────────────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────────────────────

class ChecklistStatus(str, enum.Enum):
    PENDENTE = "pendente"
    INFERIDO = "inferido"
    CONFIRMADO = "confirmado"
    DISPENSADO = "dispensado"


class ChecklistCriticidade(str, enum.Enum):
    BLOQUEANTE = "bloqueante"
    ALTO = "alto"
    MEDIO = "medio"
    BAIXO = "baixo"


class ChecklistOwner(str, enum.Enum):
    USUARIO = "usuario"
    ORGAO = "orgao"
    SISTEMA = "sistema"
    JURIDICO = "juridico"


class MensagemRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class FonteOrigem(str, enum.Enum):
    USUARIO = "usuario"
    SISTEMA = "sistema"
    DOCUMENTO = "documento"
    PESQUISA = "pesquisa"


class ClassificacaoPreco(str, enum.Enum):
    DIRETA = "direta"
    INDIRETA = "indireta"
    PARAMETRICA = "parametrica"
    COMPLEMENTAR = "complementar"
    OUTLIER = "outlier"
    DESCARTADA = "descartada"


class TurnIntent(str, enum.Enum):
    CONFIRMAR_DECISAO = "confirmar_decisao"
    FORNECER_FATO = "fornecer_fato"
    FORNECER_FONTE_PRECO = "fornecer_fonte_preco"
    PEDIR_GERACAO = "pedir_geracao"
    PEDIR_REVISAO = "pedir_revisao"
    PERGUNTAR_PROCESSO = "perguntar_processo"
    DISPENSAR_ITEM = "dispensar_item"
    OVERRIDE = "override"
    OUTRO = "outro"


# ─────────────────────────────────────────────────────────────────────────────
# Mensagem / Conversa
# ─────────────────────────────────────────────────────────────────────────────

class Anexo(BaseModel):
    tipo: Literal["url", "arquivo", "imagem", "texto"]
    nome: str
    gcs_uri: Optional[str] = None
    url: Optional[str] = None


class MensagemIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=200000)
    anexos: list[Anexo] = Field(default_factory=list)


class MensagemOut(BaseModel):
    id: UUID
    role: MensagemRole
    conteudo: str
    meta: dict[str, Any] = Field(default_factory=dict)
    anexos: list[Anexo] = Field(default_factory=list)
    criado_em: datetime


class ChatHistoryResponse(BaseModel):
    messages: list[MensagemOut]
    has_more: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# Saída estruturada do orchestrator (ConversationTurnAnalysis)
# ─────────────────────────────────────────────────────────────────────────────

class FactToAdd(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    tipo: str = Field(validation_alias=AliasChoices("tipo", "fato", "key", "chave", "path", "name", "field", "id"))
    valor: Any = Field(default=None, validation_alias=AliasChoices("valor", "value", "val"))
    confianca: float = Field(0.7, ge=0.0, le=1.0, validation_alias=AliasChoices("confianca", "confidence"))
    confirmado: bool = Field(False, validation_alias=AliasChoices("confirmado", "confirmed"))


class DecisionToAdd(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    tipo: str = Field(validation_alias=AliasChoices("tipo", "decisao", "key", "chave", "path", "name", "field", "id"))
    valor: Any = Field(default=None, validation_alias=AliasChoices("valor", "value", "val"))
    justificativa: Optional[str] = Field(default=None, validation_alias=AliasChoices("justificativa", "justification", "rationale", "reason"))
    fonte: FonteOrigem = Field(default=FonteOrigem.USUARIO, validation_alias=AliasChoices("fonte", "source", "origin"))


class ChecklistUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    item_key: str = Field(validation_alias=AliasChoices("item_key", "item", "key", "chave", "path", "name", "field", "id"))
    status: ChecklistStatus
    valor: Optional[Any] = Field(default=None, validation_alias=AliasChoices("valor", "value", "val"))
    justificativa: Optional[str] = Field(default=None, validation_alias=AliasChoices("justificativa", "justification", "rationale", "reason"))


class PriceSourceToAdd(BaseModel):
    tipo: Literal["url", "texto_colado", "arquivo", "print"]
    url: Optional[str] = None
    texto_colado: Optional[str] = None
    arquivo_gcs_uri: Optional[str] = None
    produto: Optional[str] = None
    valor_total: Optional[float] = None
    quantidade: Optional[float] = None
    vigencia_meses: Optional[int] = None


class CalculationToRun(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    operacao: str = Field(validation_alias=AliasChoices("operacao", "operation", "op", "name", "tipo", "type", "action", "command"))
    parametros: dict[str, Any] = Field(default_factory=dict, validation_alias=AliasChoices("parametros", "parameters", "params", "args"))

    @field_validator("operacao", mode="before")
    @classmethod
    def _coerce_str(cls, v: Any) -> Any:
        # Permite que o LLM passe uma string crua: "gerar_mapa_precos"
        if isinstance(v, str):
            return v
        return v


class SuggestedAction(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    label: str = Field(validation_alias=AliasChoices("label", "text", "title", "name"))
    command: str = Field(default="", validation_alias=AliasChoices("command", "action", "value", "id"))  # comando interno


class ConversationTurnAnalysis(BaseModel):
    """Saída JSON forçada do Gemini Flash para cada turno do usuário."""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    intent: TurnIntent
    facts_to_add: list[FactToAdd] = Field(default_factory=list)
    decisions_to_add: list[DecisionToAdd] = Field(default_factory=list)
    checklist_updates: list[ChecklistUpdate] = Field(default_factory=list)
    price_sources_to_add: list[PriceSourceToAdd] = Field(default_factory=list)
    calculations_to_run: list[CalculationToRun] = Field(default_factory=list)
    user_response: str = Field(..., description="Texto a ser exibido para o usuário")
    next_best_question: Optional[str] = None
    suggested_actions: list[SuggestedAction] = Field(default_factory=list)

    @field_validator("calculations_to_run", mode="before")
    @classmethod
    def _coerce_calculations(cls, v: Any) -> Any:
        # LLM às vezes manda lista de strings ou string simples
        if v is None:
            return []
        if isinstance(v, str):
            return [{"operacao": v}]
        if isinstance(v, list):
            out = []
            for x in v:
                if isinstance(x, str):
                    out.append({"operacao": x})
                else:
                    out.append(x)
            return out
        return v


# ─────────────────────────────────────────────────────────────────────────────
# Checklist
# ─────────────────────────────────────────────────────────────────────────────

class ChecklistItem(BaseModel):
    item_key: str
    categoria: str
    label: str
    status: ChecklistStatus
    criticidade: ChecklistCriticidade
    owner: ChecklistOwner
    valor: Optional[Any] = None
    evidence_ids: list[str] = Field(default_factory=list)
    justificativa: Optional[str] = None
    atualizado_em: Optional[datetime] = None


class ChecklistSummary(BaseModel):
    total: int
    confirmado: int
    inferido: int
    pendente: int
    dispensado: int
    bloqueante_pendente: int


class ChecklistResponse(BaseModel):
    by_category: dict[str, list[ChecklistItem]]
    summary: ChecklistSummary


class ChecklistPatch(BaseModel):
    status: ChecklistStatus
    valor: Optional[Any] = None
    justificativa: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Readiness
# ─────────────────────────────────────────────────────────────────────────────

class MissingItem(BaseModel):
    item_key: str
    label: str
    criticidade: ChecklistCriticidade
    owner: ChecklistOwner


class DocumentReadiness(BaseModel):
    doc_type: Literal["etp", "tr", "mapa_precos"]
    can_generate: bool
    score: float = Field(..., ge=0.0, le=1.0)
    blocking_missing: list[MissingItem] = Field(default_factory=list)
    optional_missing: list[MissingItem] = Field(default_factory=list)
    inferred_items: list[MissingItem] = Field(default_factory=list)
    open_fields_for_orgao: list[MissingItem] = Field(default_factory=list)
    recommendations: Optional[str] = None
    avaliado_em: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# Sprint B — Price Workbench
# ─────────────────────────────────────────────────────────────────────────────

class FonteUsuarioStatus(str, enum.Enum):
    PENDENTE = "pendente"
    VALIDADA = "validada"
    DESCARTADA = "descartada"


class FonteUsuarioIn(BaseModel):
    tipo: Literal["url", "texto_colado", "arquivo", "print"]
    url: Optional[str] = None
    texto_colado: Optional[str] = None
    arquivo_gcs_uri: Optional[str] = None
    produto: Optional[str] = None
    observacao: Optional[str] = None


class FonteUsuario(BaseModel):
    id: UUID
    contratacao_id: str
    tipo: Literal["url", "texto_colado", "arquivo", "print"]
    status: FonteUsuarioStatus
    url: Optional[str] = None
    texto_colado: Optional[str] = None
    arquivo_gcs_uri: Optional[str] = None
    produto: Optional[str] = None
    valor_total: Optional[float] = None
    quantidade: Optional[float] = None
    vigencia_meses: Optional[int] = None
    valor_mensal_unitario: Optional[float] = None
    classificacao: Optional[ClassificacaoPreco] = None
    score: Optional[float] = None
    observacao: Optional[str] = None
    criado_em: datetime
    validado_em: Optional[datetime] = None


class FonteUsuarioPatch(BaseModel):
    classificacao: Optional[ClassificacaoPreco] = None
    status: Optional[FonteUsuarioStatus] = None
    observacao: Optional[str] = None


class PesquisaNegativaIn(BaseModel):
    termo: str = Field(..., min_length=1)
    fontes_consultadas: list[str] = Field(default_factory=list)
    justificativa: Optional[str] = None
    efeito_na_estimativa: Optional[str] = None


class PesquisaNegativa(PesquisaNegativaIn):
    id: UUID
    contratacao_id: str
    criado_em: datetime


# ─────────────────────────────────────────────────────────────────────────────
# Sprint C — Documentos gerados (versão leve)
# ─────────────────────────────────────────────────────────────────────────────

class DocumentoGeradoLite(BaseModel):
    id: UUID
    contratacao_id: str
    doc_type: Literal["etp", "tr", "mapa_precos"]
    versao: int
    content_md: str
    readiness_snapshot: DocumentReadiness
    gerado_em: datetime


# ─────────────────────────────────────────────────────────────────────────────
# Sprint D extra — Aprovações + Eventos
# ─────────────────────────────────────────────────────────────────────────────

class AprovacaoIn(BaseModel):
    aprovado_por: str = Field(..., min_length=1)
    papel: str = Field(..., min_length=1)
    decisao: Literal["aprovado", "rejeitado", "retorno"]
    comentario: Optional[str] = None


class Aprovacao(AprovacaoIn):
    id: UUID
    contratacao_id: str
    documento_id: UUID
    criado_em: datetime


class EventoOut(BaseModel):
    id: UUID
    contratacao_id: str
    tipo: str
    payload: dict
    lido: bool
    criado_em: datetime
