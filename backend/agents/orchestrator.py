"""Orquestrador sequencial dos 4 agentes.

Versão MVP (sem ADK): encadeia Extrator → Qualificador → Analista → Persistor.
Cada agente loga structured JSON via `logging` (alimenta o dashboard Fase 3).

Migração futura para `google.adk.agents.SequentialAgent` é trivial — basta
embrulhar cada função em `LlmAgent` mantendo o mesmo contrato Pydantic.
"""
from __future__ import annotations

import logging
import time
import uuid

from backend.agents.analista import analisar
from backend.agents.extrator import extrair_edital
from backend.agents.persistor import persistir
from backend.agents.qualificador import qualificar
from backend.models.schemas import ParecerFinal

log = logging.getLogger("lici_adk.orchestrator")


def analisar_edital(
    pdf_bytes: bytes,
    *,
    trace_id: str | None = None,
    edital_filename: str | None = None,
) -> ParecerFinal:
    """Pipeline ponta-a-ponta. Retorna ParecerFinal.

    Levanta exceções dos agentes para o caller decidir como tratar (FastAPI
    transforma em status `failed` no job store). O Persistor falha silenciosamente
    — nunca bloqueia a resposta da API.
    """
    trace_id = trace_id or str(uuid.uuid4())
    t0 = time.time()
    log.info("orchestrator.start", extra={"lici_adk": {"trace_id": trace_id, "pdf_bytes": len(pdf_bytes)}})

    edital = extrair_edital(pdf_bytes)
    qualificador = qualificar(edital)
    parecer = analisar(edital, qualificador)
    parecer.trace_id = trace_id

    pipeline_ms = int((time.time() - t0) * 1000)

    # Persistência assíncrona — falha silenciosa, não bloqueia resposta
    persistir(
        parecer,
        edital,
        edital_filename=edital_filename,
        pdf_bytes=pdf_bytes,
        pipeline_ms=pipeline_ms,
    )

    log.info(
        "orchestrator.done",
        extra={
            "lici_adk": {
                "trace_id": trace_id,
                "total_ms": pipeline_ms,
                "status": parecer.status,
                "score": parecer.score_aderencia,
            }
        },
    )
    return parecer
