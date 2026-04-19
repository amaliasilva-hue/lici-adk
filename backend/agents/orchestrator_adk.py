"""Orquestrador ADK — Fase 2.

Substitui o orchestrator.py (Python puro) por um pipeline baseado em
google-adk SequentialAgent, mantendo o mesmo contrato externo:
    analisar_edital(pdf_bytes, *, trace_id, edital_filename) → ParecerComercial

Padrão de estado:
  - session.state["pdf_bytes"]      bytes — payload inicial
  - session.state["trace_id"]       str
  - session.state["edital_filename"] str | None
  - session.state["edital_json"]    dict — output do Extrator
  - session.state["qualificador_json"] dict — output do Qualificador
  - session.state["parecer_json"]   dict — output do Analista Comercial
  - session.state["pipeline_ms"]    int — latência total

Cada sub-agente lê de session.state e persiste seu output via
EventActions(state_delta=...) — único mecanismo que garante escrita
durável na sessão do ADK.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncGenerator
from typing import override

from google.adk.agents import BaseAgent, SequentialAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.adk.runners import InMemoryRunner
from google.genai import types

from backend.agents.analista_comercial import analisar
from backend.agents.extrator import extrair_edital
from backend.agents.persistor import persistir
from backend.agents.qualificador import qualificar
from backend.models.schemas import EditalEstruturado, ParecerComercial, QualificadorResult
from backend.tools.drive_tools import somar_atestados_do_drive
from backend.tools.pg_tools import get_cache, set_cache

log = logging.getLogger("lici_adk.orchestrator_adk")

_APP_NAME = "lici_adk_pipeline"


# ── Sub-agentes ──────────────────────────────────────────────────────────────

class _ExtratorAgent(BaseAgent):
    """Extrai EditalEstruturado do PDF via Gemini Flash."""

    @override
    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        pdf_bytes: bytes = ctx.session.state["pdf_bytes"]
        log.info("adk.extrator.start", extra={"lici_adk": {"trace_id": ctx.session.state.get("trace_id")}})
        edital = await asyncio.to_thread(extrair_edital, pdf_bytes)
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text="extrator_ok")]),
            actions=EventActions(state_delta={"edital_json": edital.model_dump()}),
        )


class _QualificadorAgent(BaseAgent):
    """Consulta BigQuery com os keywords do edital."""

    @override
    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        edital = EditalEstruturado.model_validate(ctx.session.state["edital_json"])
        log.info("adk.qualificador.start", extra={"lici_adk": {"trace_id": ctx.session.state.get("trace_id")}})
        result = await asyncio.to_thread(qualificar, edital)
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text="qualificador_ok")]),
            actions=EventActions(state_delta={"qualificador_json": result.model_dump()}),
        )


class _SomadorAgent(BaseAgent):
    """Soma atestados da pasta Drive do edital (Fase 4).

    Fluxo:
      1. Lê `drive_folder_id` do edital.
      2. Verifica cache Postgres (`atestados_cache`).
      3. Se cache miss ou não configurado, chama `somar_atestados_do_drive()`.
      4. Persiste no cache e publica `somatorio_drive_json` no estado ADK.

    Falha silenciosa: se Drive não acessível, publica `None` no estado —
    o Analista Comercial continua sem o somatório.
    """

    @override
    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        edital = EditalEstruturado.model_validate(ctx.session.state["edital_json"])
        trace_id = ctx.session.state.get("trace_id")
        folder_id: str | None = getattr(edital, "drive_folder_id", None)

        somatorio_dict: dict | None = None

        if folder_id:
            # 1. Tenta cache Postgres
            try:
                cached = await asyncio.to_thread(get_cache, edital.id or trace_id or "")
                if cached:
                    log.info(
                        "adk.somador.cache_hit",
                        extra={"lici_adk": {"trace_id": trace_id, "edital_id": edital.id}},
                    )
                    somatorio_dict = cached
            except Exception:
                log.exception("adk.somador.cache_read_failed")

            # 2. Cache miss — chama Drive
            if somatorio_dict is None:
                try:
                    edital_id = edital.id or trace_id or ""
                    valor_est = getattr(edital, "valor_estimado", None)
                    vol_exigido = getattr(edital, "volume_exigido_principal", 0.0)
                    somatorio = await asyncio.to_thread(
                        somar_atestados_do_drive,
                        edital_id,
                        drive_folder_id=folder_id,
                        volume_exigido=float(vol_exigido or 0),
                        valor_estimado_edital=float(valor_est) if valor_est else None,
                    )
                    somatorio_dict = somatorio.to_dict()
                    # 3. Persiste cache (falha silenciosa)
                    try:
                        await asyncio.to_thread(set_cache, edital_id, somatorio)
                    except Exception:
                        log.exception("adk.somador.cache_write_failed")
                    log.info(
                        "adk.somador.drive_ok",
                        extra={
                            "lici_adk": {
                                "trace_id": trace_id,
                                "pdfs_ok": somatorio.pdfs_processados,
                                "pdfs_err": somatorio.pdfs_com_erro,
                                "drive_indisponivel": somatorio.drive_indisponivel,
                            }
                        },
                    )
                except Exception:
                    log.exception(
                        "adk.somador.drive_failed",
                        extra={"lici_adk": {"trace_id": trace_id}},
                    )
        else:
            log.info(
                "adk.somador.sem_folder_id",
                extra={"lici_adk": {"trace_id": trace_id}},
            )

        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text="somador_ok")]),
            actions=EventActions(state_delta={"somatorio_drive_json": somatorio_dict}),
        )


class _AnalistaComercialAgent(BaseAgent):
    """Produz o ParecerComercial com score, gaps e evidências."""

    @override
    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        edital = EditalEstruturado.model_validate(ctx.session.state["edital_json"])
        qual = QualificadorResult.model_validate(ctx.session.state["qualificador_json"])
        somatorio = ctx.session.state.get("somatorio_drive_json")  # dict | None
        log.info("adk.analista_comercial.start", extra={"lici_adk": {"trace_id": ctx.session.state.get("trace_id")}})
        parecer = await asyncio.to_thread(analisar, edital, qual, somatorio_drive=somatorio)
        parecer.trace_id = ctx.session.state.get("trace_id")
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text="analista_ok")]),
            actions=EventActions(state_delta={"parecer_json": parecer.model_dump()}),
        )


class _PersistorAgent(BaseAgent):
    """Persiste o parecer no BigQuery (falha silenciosa)."""

    @override
    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        state = ctx.session.state
        try:
            parecer = ParecerComercial.model_validate(state["parecer_json"])
            edital = EditalEstruturado.model_validate(state["edital_json"])
            pipeline_ms = state.get("pipeline_ms", 0)
            await asyncio.to_thread(
                persistir,
                parecer,
                edital,
                edital_filename=state.get("edital_filename"),
                pdf_bytes=state.get("pdf_bytes"),
                pipeline_ms=pipeline_ms,
            )
        except Exception:  # noqa: BLE001
            log.exception("adk.persistor.failed", extra={"lici_adk": {"trace_id": state.get("trace_id")}})
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text="persistor_ok")]),
        )


# ── Pipeline ────────────────────────────────────────────────────────────────

_pipeline = SequentialAgent(
    name="lici_adk_pipeline",
    description="Extrator → Qualificador → Somador → Analista Comercial → Persistor",
    sub_agents=[
        _ExtratorAgent(name="extrator"),
        _QualificadorAgent(name="qualificador"),
        _SomadorAgent(name="somador"),
        _AnalistaComercialAgent(name="analista_comercial"),
        _PersistorAgent(name="persistor"),
    ],
)

_runner = InMemoryRunner(agent=_pipeline, app_name=_APP_NAME)


# ── Ponto de entrada público ─────────────────────────────────────────────────

async def analisar_edital_async(
    pdf_bytes: bytes,
    *,
    trace_id: str | None = None,
    edital_filename: str | None = None,
) -> ParecerComercial:
    """Pipeline ponta-a-ponta via ADK. Retorna ParecerComercial."""
    trace_id = trace_id or str(uuid.uuid4())
    user_id = f"pipeline_{trace_id}"
    t0 = time.time()

    log.info("adk.orchestrator.start", extra={"lici_adk": {"trace_id": trace_id, "pdf_bytes": len(pdf_bytes)}})

    session = await _runner.session_service.create_session(
        app_name=_APP_NAME,
        user_id=user_id,
        state={
            "pdf_bytes": pdf_bytes,
            "trace_id": trace_id,
            "edital_filename": edital_filename,
        },
    )

    async for _ in _runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=types.Content(role="user", parts=[types.Part(text="analisar")]),
    ):
        pass  # eventos tratados pelos sub-agentes

    pipeline_ms = int((time.time() - t0) * 1000)

    final = await _runner.session_service.get_session(
        app_name=_APP_NAME,
        user_id=user_id,
        session_id=session.id,
    )

    if not final or "parecer_json" not in final.state:
        raise RuntimeError(f"Pipeline ADK não produziu parecer. trace_id={trace_id}")

    parecer = ParecerComercial.model_validate(final.state["parecer_json"])
    log.info(
        "adk.orchestrator.done",
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


def analisar_edital(
    pdf_bytes: bytes,
    *,
    trace_id: str | None = None,
    edital_filename: str | None = None,
) -> ParecerComercial:
    """Wrapper síncrono de `analisar_edital_async` — mantém compatibilidade com main.py."""
    return asyncio.run(
        analisar_edital_async(pdf_bytes, trace_id=trace_id, edital_filename=edital_filename)
    )
