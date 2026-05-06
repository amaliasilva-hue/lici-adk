"""Orquestrador principal — xerticaproc.

Coordena os 9 agentes em sequência, gerenciando estado via EvidenceBundle.
Cada etapa pode ser executada de forma isolada (para retomada após aprovação humana).

Pipeline completo:
  demanda → decomposicao → mercado → precos → tecnico → juridico → riscos → etp → tr → revisao
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any
from uuid import UUID

from xerticaproc.backend.agents.decomposicao_agent import decompor_objeto
from xerticaproc.backend.agents.demanda_agent import estruturar_demanda
from xerticaproc.backend.agents.juridico_agent import validar_juridico
from xerticaproc.backend.agents.mercado_agent import pesquisar_mercado
from xerticaproc.backend.agents.precos_agent import pesquisar_precos
from xerticaproc.backend.agents.redator_agent import redigir_etp, redigir_tr
from xerticaproc.backend.agents.revisor_agent import revisar_documento
from xerticaproc.backend.agents.riscos_agent import gerar_matriz_riscos
from xerticaproc.backend.agents.tecnico_agent import gerar_requisitos_tecnicos
from xerticaproc.backend.models.schemas import (
    DocumentoGerado,
    EntradaDemanda,
    EvidenceBundle,
    MapaPrecos,
    RelatorioRevisao,
    TipoDocumento,
    UnidadeMedida,
)

log = logging.getLogger("xerticaproc.orchestrator")


class OrchestratorResult:
    """Resultado completo de uma execução do pipeline."""

    def __init__(self, contratacao_id: UUID):
        self.contratacao_id = contratacao_id
        self.bundle: EvidenceBundle = EvidenceBundle(
            contratacao_id=contratacao_id,
            etapa="inicio",
        )
        self.etp: DocumentoGerado | None = None
        self.tr: DocumentoGerado | None = None
        self.revisao_etp: RelatorioRevisao | None = None
        self.revisao_tr: RelatorioRevisao | None = None
        self.erros: list[str] = []
        self.inicio_ts = time.monotonic()

    @property
    def latencia_ms(self) -> int:
        return int((time.monotonic() - self.inicio_ts) * 1000)


def executar_pipeline_completo(
    entrada: EntradaDemanda,
    documentos_pdf: list[bytes] | None = None,
    unidade_medida_principal: UnidadeMedida = UnidadeMedida.USUARIO,
    quantidade_referencia: float = 1.0,
    contratacao_id: UUID | None = None,
) -> OrchestratorResult:
    """Executa o pipeline completo de geração de ETP/TR.
    
    Este método é síncrono e pode ser chamado via Cloud Run Job ou Workflows.
    Para execução assíncrona (API), usar executar_etapa() individualmente.
    """
    if contratacao_id is None:
        contratacao_id = uuid.uuid4()

    result = OrchestratorResult(contratacao_id)
    log.info("orchestrator.pipeline_start", extra={"contratacao_id": str(contratacao_id)})

    try:
        # ── Etapa 1: Demanda ─────────────────────────────────────────────────
        log.info("orchestrator.etapa_demanda")
        result.bundle.etapa = "demanda"
        result.bundle.demanda = estruturar_demanda(entrada, documentos_pdf)

        # ── Etapa 2: Decomposição ─────────────────────────────────────────────
        log.info("orchestrator.etapa_decomposicao")
        result.bundle.etapa = "decomposicao"
        result.bundle.objeto_decomposto = decompor_objeto(
            result.bundle.demanda,
            quantidades=entrada.quantidades,
        )

        # ── Etapa 3: Mercado ──────────────────────────────────────────────────
        log.info("orchestrator.etapa_mercado")
        result.bundle.etapa = "mercado"
        result.bundle.matriz_alternativas = pesquisar_mercado(result.bundle.objeto_decomposto)

        # ── Etapa 4: Preços ───────────────────────────────────────────────────
        log.info("orchestrator.etapa_precos")
        result.bundle.etapa = "precos"
        result.bundle.mapa_precos = pesquisar_precos(
            objeto=result.bundle.objeto_decomposto,
            contratacao_id=contratacao_id,
            prazo_meses=entrada.prazo_estimado_meses,
            quantidades=entrada.quantidades,
            orgao=entrada.orgao,
            restricoes=entrada.restricoes,
            unidade_medida_principal=unidade_medida_principal,
            quantidade_referencia=quantidade_referencia,
        )

        # ── Etapa 5: Técnico ──────────────────────────────────────────────────
        log.info("orchestrator.etapa_tecnico")
        result.bundle.etapa = "tecnico"
        result.bundle.requisitos_tecnicos = gerar_requisitos_tecnicos(
            demanda=result.bundle.demanda,
            objeto=result.bundle.objeto_decomposto,
            alternativa_escolhida=result.bundle.matriz_alternativas,
        )

        # ── Etapa 6: Jurídico ─────────────────────────────────────────────────
        log.info("orchestrator.etapa_juridico")
        result.bundle.etapa = "juridico"
        result.bundle.validacao_juridica = validar_juridico(
            demanda=result.bundle.demanda,
            objeto=result.bundle.objeto_decomposto,
            requisitos=result.bundle.requisitos_tecnicos,
        )

        # ── Etapa 7: Riscos ───────────────────────────────────────────────────
        log.info("orchestrator.etapa_riscos")
        result.bundle.etapa = "riscos"
        result.bundle.matriz_riscos = gerar_matriz_riscos(
            demanda=result.bundle.demanda,
            objeto=result.bundle.objeto_decomposto,
            mapa_precos=result.bundle.mapa_precos,
            matriz_alternativas=result.bundle.matriz_alternativas,
            validacao_juridica=result.bundle.validacao_juridica,
        )

        # Verificar se pode prosseguir para redação
        if not result.bundle.matriz_riscos.aprovado_para_prosseguir:
            result.erros.append(
                f"Matriz de riscos não aprovada para prosseguir. "
                f"Condições: {result.bundle.matriz_riscos.condicoes_para_prosseguir}"
            )
            log.warning("orchestrator.riscos_bloqueiam_prosseguimento")
            return result

        # ── Etapa 8: Redação ETP ─────────────────────────────────────────────
        log.info("orchestrator.etapa_etp")
        result.bundle.etapa = "etp"
        result.etp = redigir_etp(result.bundle)

        # ── Etapa 8b: Revisão ETP ────────────────────────────────────────────
        result.revisao_etp = revisar_documento(result.etp, result.bundle)
        log.info(
            "orchestrator.etp_revisado",
            extra={
                "aprovado": result.revisao_etp.aprovado,
                "pendencias_criticas": result.revisao_etp.pendencias_criticas,
            },
        )

        # ── Etapa 9: Redação TR ──────────────────────────────────────────────
        log.info("orchestrator.etapa_tr")
        result.bundle.etapa = "tr"
        result.tr = redigir_tr(result.bundle)

        # ── Etapa 9b: Revisão TR ─────────────────────────────────────────────
        result.revisao_tr = revisar_documento(result.tr, result.bundle)
        log.info(
            "orchestrator.tr_revisado",
            extra={
                "aprovado": result.revisao_tr.aprovado,
                "pendencias_criticas": result.revisao_tr.pendencias_criticas,
            },
        )

        result.bundle.etapa = "concluido"

    except Exception as exc:
        log.exception("orchestrator.pipeline_error", extra={"error": str(exc)})
        result.erros.append(str(exc))

    log.info(
        "orchestrator.pipeline_done",
        extra={
            "contratacao_id": str(contratacao_id),
            "latencia_ms": result.latencia_ms,
            "erros": len(result.erros),
        },
    )
    return result


def executar_etapa(
    etapa: str,
    bundle: EvidenceBundle,
    entrada: EntradaDemanda | None = None,
    **kwargs: Any,
) -> EvidenceBundle:
    """Executa uma única etapa do pipeline.
    
    Permite retomada após aprovação humana sem reexecutar etapas anteriores.
    
    Etapas: demanda|decomposicao|mercado|precos|tecnico|juridico|riscos|etp|tr
    """
    if etapa == "demanda":
        assert entrada is not None, "EntradaDemanda obrigatória para etapa 'demanda'"
        bundle.demanda = estruturar_demanda(entrada, kwargs.get("documentos_pdf"))

    elif etapa == "decomposicao":
        assert bundle.demanda, "Execute 'demanda' antes de 'decomposicao'"
        bundle.objeto_decomposto = decompor_objeto(
            bundle.demanda,
            quantidades=kwargs.get("quantidades", {}),
        )

    elif etapa == "mercado":
        assert bundle.objeto_decomposto, "Execute 'decomposicao' antes de 'mercado'"
        bundle.matriz_alternativas = pesquisar_mercado(bundle.objeto_decomposto)

    elif etapa == "precos":
        assert bundle.objeto_decomposto, "Execute 'decomposicao' antes de 'precos'"
        assert entrada is not None, "EntradaDemanda obrigatória para extrair prazo/orgão/quantidades"
        bundle.mapa_precos = pesquisar_precos(
            objeto=bundle.objeto_decomposto,
            contratacao_id=bundle.contratacao_id,
            prazo_meses=entrada.prazo_estimado_meses,
            quantidades=entrada.quantidades,
            orgao=entrada.orgao,
            restricoes=entrada.restricoes,
            unidade_medida_principal=kwargs.get("unidade_medida_principal", UnidadeMedida.USUARIO),
            quantidade_referencia=kwargs.get("quantidade_referencia", 1.0),
        )

    elif etapa == "tecnico":
        assert bundle.demanda and bundle.objeto_decomposto
        bundle.requisitos_tecnicos = gerar_requisitos_tecnicos(
            demanda=bundle.demanda,
            objeto=bundle.objeto_decomposto,
            alternativa_escolhida=bundle.matriz_alternativas,
        )

    elif etapa == "juridico":
        assert bundle.demanda and bundle.objeto_decomposto and bundle.requisitos_tecnicos
        bundle.validacao_juridica = validar_juridico(
            demanda=bundle.demanda,
            objeto=bundle.objeto_decomposto,
            requisitos=bundle.requisitos_tecnicos,
        )

    elif etapa == "riscos":
        assert bundle.demanda and bundle.objeto_decomposto
        bundle.matriz_riscos = gerar_matriz_riscos(
            demanda=bundle.demanda,
            objeto=bundle.objeto_decomposto,
            mapa_precos=bundle.mapa_precos,
            matriz_alternativas=bundle.matriz_alternativas,
            validacao_juridica=bundle.validacao_juridica,
        )

    else:
        raise ValueError(f"Etapa desconhecida: {etapa}")

    bundle.etapa = etapa
    return bundle
