"""FastAPI app — endpoint /analyze assíncrono.

Contrato (ARCHITECTURE.md §Contrato da API):
  POST /analyze              → multipart com PDF, retorna {analysis_id, status: queued}
  GET  /analyze/{id}         → polling, retorna {status, current_agent, result?, error?}
  POST /analyze/from-drive   → analisa PDF do Google Drive por file_id
  POST /analyze/from-drive-folder → importa todos os PDFs de uma pasta Drive
  GET  /health               → health check com status do Postgres
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Literal

import httpx
from sqlalchemy import text

from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.agents.orchestrator_adk import analisar_edital
from backend.agents.persistor import DEST_DATASET, DEST_PROJECT, DEST_TABLE
from backend.logging_config import configure_logging
from backend.models.schemas import BidConfig, EditalEstruturado, ParecerComercial, RelatorioLicitatorio
from backend.tools.pg_tools import (
    ensure_schema, invalidate_cache, invalidate_all_cache,
    create_edital, get_edital, list_editais, update_edital, soft_delete_edital,
    add_movimentacao, list_movimentacoes,
    add_comentario, list_comentarios,
    seed_gates, list_gates, set_gate,
    STAGES_ORDER, ESTADOS_TERMINAIS,
    get_engine, _serialize_row,
    # Fase 7 — jobs persistentes
    create_job, get_job, touch_job, find_job_by_sha256, list_jobs,
    mark_orphan_jobs_failed,
    # Novos endpoints (Lote 1)
    get_historico_orgao, bulk_update_editais,
    create_notification, list_notifications, mark_notifications_read,
)
from google.cloud import bigquery

configure_logging()
log = logging.getLogger("lici_adk.api")

app = FastAPI(title="lici-adk", version="0.1.0")

# Internal self-call client (used by webhooks to delegate to upload endpoints)
_SELF_BASE = "http://localhost:8080"
_client = httpx.AsyncClient(base_url=_SELF_BASE, timeout=60.0)

@app.on_event("startup")
async def _startup() -> None:
    """Cria tabelas Postgres na inicialização (idempotente)."""
    try:
        await asyncio.to_thread(ensure_schema)
        log.info("startup.pg_schema_ok")
    except Exception as exc:
        # Falha silenciosa: Cloud SQL pode não estar disponível em env dev
        log.warning("startup.pg_schema_failed", extra={"error": str(exc)})
    # Marca jobs órfãos (queued/running sem atualização há > 10min) como failed
    # Isso limpa estado inconsistente deixado por restarts anteriores
    try:
        count = await asyncio.to_thread(mark_orphan_jobs_failed)
        if count:
            log.warning("startup.orphan_jobs_cleaned", extra={"count": count})
    except Exception as exc:
        log.warning("startup.orphan_cleanup_failed", extra={"error": str(exc)})

MAX_PDF_BYTES = int(os.getenv("LICI_MAX_PDF_BYTES", str(30 * 1024 * 1024)))  # 30 MB

JobStatus = Literal["queued", "running", "done", "failed"]


class JobState(BaseModel):
    analysis_id: str
    status: JobStatus = "queued"
    current_agent: Literal["extrator", "qualificador", "analista"] | None = None
    estimated_seconds: int = 35
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    result: ParecerComercial | None = None
    error: str | None = None
    edital_filename: str | None = None
    # Fase 5 — dados extras do pipeline + análise jurídica
    edital_json: dict | None = None
    somatorio_drive_json: dict | None = None
    relatorio_juridico: RelatorioLicitatorio | None = None
    job_juridico_status: Literal["not_started", "running", "done", "failed"] = "not_started"
    error_juridico: str | None = None
    # Fase 6 — edital_id do Postgres criado após pipeline
    pg_edital_id: str | None = None


# ── Helpers de job (Fase 7: Postgres-backed, sem _JOBS in-memory) ─────────────

def _get_job(analysis_id: str) -> JobState | None:
    """Lê job do Postgres e hidrata JobState."""
    row = get_job(analysis_id)
    if not row:
        return None
    return _row_to_jobstate(row)


def _row_to_jobstate(row: dict) -> JobState:
    """Converte row do Postgres em JobState deserializando campos JSONB."""
    def _maybe_json(v):
        if v is None:
            return None
        return v if isinstance(v, dict) else json.loads(v)

    result = None
    rj = _maybe_json(row.get("result_json"))
    if rj:
        try:
            result = ParecerComercial.model_validate(rj)
        except Exception:
            pass

    relatorio = None
    rel_data = _maybe_json(row.get("relatorio_juridico_json"))
    if rel_data:
        try:
            relatorio = RelatorioLicitatorio.model_validate(rel_data)
        except Exception:
            pass

    return JobState(
        analysis_id=str(row["analysis_id"]),
        status=row.get("status", "queued"),
        current_agent=row.get("current_agent"),
        estimated_seconds=row.get("estimated_seconds", 35),
        created_at=row["created_at"] if hasattr(row.get("created_at"), "tzinfo") else datetime.now(timezone.utc),
        updated_at=row["updated_at"] if hasattr(row.get("updated_at"), "tzinfo") else datetime.now(timezone.utc),
        result=result,
        error=row.get("error"),
        edital_filename=row.get("edital_filename"),
        edital_json=_maybe_json(row.get("edital_json")),
        somatorio_drive_json=_maybe_json(row.get("somatorio_drive_json")),
        relatorio_juridico=relatorio,
        job_juridico_status=row.get("job_juridico_status", "not_started"),
        error_juridico=row.get("error_juridico"),
        pg_edital_id=row.get("pg_edital_id"),
    )


def _touch(analysis_id: str | JobState, **kwargs) -> None:
    """Persiste atualizações de campo no job (Postgres). Aceita analysis_id str ou JobState."""
    aid = analysis_id.analysis_id if isinstance(analysis_id, JobState) else analysis_id
    # Mapeia campos do JobState para colunas do Postgres
    pg_kwargs: dict = {}
    for k, v in kwargs.items():
        if k == "result":
            pg_kwargs["result_json"] = v.model_dump() if v is not None else None
        elif k == "relatorio_juridico":
            pg_kwargs["relatorio_juridico_json"] = v.model_dump() if v is not None else None
        else:
            pg_kwargs[k] = v
    touch_job(aid, **pg_kwargs)


def _maybe_notify_analysis_done(analysis_id: str, edital_row: dict, parecer: object | None) -> None:
    """Cria notificação in-app quando análise termina. Best-effort — não propaga exceções."""
    vendedor = edital_row.get("vendedor_email") or edital_row.get("criado_por")
    if not vendedor or vendedor == "pipeline":
        return  # sem destinatário conhecido
    orgao = edital_row.get("orgao") or "Edital"
    score = getattr(parecer, "score_aderencia", None) if parecer else None
    status_text = getattr(parecer, "status", None) if parecer else None
    score_str = f" — Score {score}%" if score is not None else ""
    status_str = f" ({status_text})" if status_text else ""
    create_notification(
        user_email=vendedor,
        type="analysis_done",
        title=f"Análise concluída: {orgao}{score_str}{status_str}",
        body=f"A análise do edital de {orgao} foi concluída e está disponível no pipeline.",
        entity_type="edital",
        entity_id=str(edital_row.get("edital_id", "")),
    )


def _run_pipeline(analysis_id: str, pdf_bytes: bytes, filename: str | None = None) -> None:
    # Maps ADK agent name → next current_agent label for the frontend
    _NEXT_STAGE: dict[str, str] = {
        "extrator":            "qualificador",
        "qualificador":        "analista",
        "somador":             "analista",
        "analista_comercial":  "analista",   # keep label until done
    }

    def _on_agent_done(agent_name: str) -> None:
        next_stage = _NEXT_STAGE.get(agent_name)
        if next_stage:
            _touch(analysis_id, current_agent=next_stage)

    try:
        _touch(analysis_id, status="running", current_agent="extrator")
        pipeline_result = analisar_edital(
            pdf_bytes, trace_id=analysis_id, edital_filename=filename,
            on_agent_done=_on_agent_done,
        )
        # Fase 6 — persiste no Cloud SQL ANTES de marcar status="done"
        # para evitar que o frontend receba done+pg_edital_id=null (race condition).
        _eid: str | None = None
        try:
            edital = pipeline_result.edital
            score = pipeline_result.parecer.score_aderencia if pipeline_result.parecer else None
            data: dict = {
                "analysis_id_comercial": analysis_id,
                "fase_atual": "identificacao",
                "criado_por": "pipeline",
            }
            if edital:
                if edital.orgao:
                    data["orgao"] = edital.orgao
                if edital.uf:
                    data["uf"] = edital.uf
                if edital.uasg:
                    data["uasg"] = edital.uasg
                if edital.objeto:
                    data["objeto"] = edital.objeto
                if edital.valor_estimado:
                    data["valor_estimado"] = edital.valor_estimado
                if edital.portal:
                    data["portal"] = edital.portal
                if edital.data_encerramento:
                    data["data_encerramento"] = edital.data_encerramento
            if score is not None:
                data["score_comercial"] = score
            if filename:
                data["edital_filename"] = filename
            if pipeline_result.parecer:
                data["result_json"] = json.dumps(pipeline_result.parecer.model_dump(), ensure_ascii=False, default=str)
            if pipeline_result.edital:
                data["edital_json_storage"] = json.dumps(pipeline_result.edital.model_dump(), ensure_ascii=False, default=str)
            row = create_edital(data)
            _eid = str(row["edital_id"])
            seed_gates(_eid, "identificacao")
            log.info("pipeline.edital_row_created", extra={"lici_adk": {"trace_id": analysis_id, "edital_id": _eid}})
        except Exception as pg_exc:  # noqa: BLE001
            log.warning("pipeline.pg_persist_failed", extra={"error": str(pg_exc)})
        # Marca done — pg_edital_id incluído atomicamente (None se persist falhou)
        _touch_kwargs: dict = {
            "status": "done",
            "current_agent": None,
            "result": pipeline_result.parecer,
            "edital_json": pipeline_result.edital.model_dump() if pipeline_result.edital else None,
            "somatorio_drive_json": pipeline_result.somatorio_drive,
        }
        if _eid:
            _touch_kwargs["pg_edital_id"] = _eid
        _touch(analysis_id, **_touch_kwargs)
        # Notificação in-app (best-effort)
        if _eid:
            try:
                _maybe_notify_analysis_done(analysis_id, row, pipeline_result.parecer)  # type: ignore[possibly-undefined]
            except Exception:
                pass
        if _eid:
            try:
                _maybe_notify_analysis_done(analysis_id, row, pipeline_result.parecer)  # type: ignore[possibly-undefined]
            except Exception:
                pass
    except Exception as exc:  # noqa: BLE001
        log.exception("pipeline.failed", extra={"lici_adk": {"trace_id": analysis_id}})
        _touch(analysis_id, status="failed", current_agent=None, error=f"{type(exc).__name__}: {exc}")


@app.get("/health")
async def healthz() -> dict:
    pg_ok = False
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        pg_ok = True
    except Exception:
        pass
    return {"status": "ok", "pg": "ok" if pg_ok else "degraded"}


@app.post("/analyze", status_code=202)
async def analyze(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="PDF do edital (máx 30 MB)"),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="arquivo deve ser .pdf")

    pdf_bytes = await file.read()
    if len(pdf_bytes) == 0:
        raise HTTPException(status_code=400, detail="PDF vazio")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"PDF excede {MAX_PDF_BYTES // (1024*1024)} MB",
        )

    # SHA256 dedup — evita reprocessar o mesmo PDF em até 30 dias
    import hashlib
    pdf_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    existing = await asyncio.to_thread(find_job_by_sha256, pdf_sha256)
    if existing:
        log.info("analyze.duplicate_detected", extra={"lici_adk": {"sha256": pdf_sha256[:16], "existing_id": existing["analysis_id"]}})
        return {
            "analysis_id": existing["analysis_id"],
            "status": "already_exists",
            "pg_edital_id": existing.get("pg_edital_id"),
            "poll_url": f"/analyze/{existing['analysis_id']}",
        }

    analysis_id = str(uuid.uuid4())
    await asyncio.to_thread(create_job, analysis_id, file.filename, pdf_sha256)
    log.info(
        "analyze.queued",
        extra={"lici_adk": {"trace_id": analysis_id, "filename": file.filename, "bytes": len(pdf_bytes)}},
    )
    background_tasks.add_task(_run_pipeline, analysis_id, pdf_bytes, file.filename)
    return {
        "analysis_id": analysis_id,
        "status": "queued",
        "estimated_seconds": 35,
        "poll_url": f"/analyze/{analysis_id}",
    }


@app.get("/analyze/{analysis_id}")
async def get_analysis(analysis_id: str) -> JobState:
    job = await asyncio.to_thread(_get_job, analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="analysis_id desconhecido")
    return job


@app.get("/analyze")
async def list_analyses(limit: int = 20) -> list[dict]:
    """Lista jobs recentes (debug)."""
    rows = await asyncio.to_thread(list_jobs, limit)
    return [
        {
            "analysis_id": r["analysis_id"],
            "status": r["status"],
            "current_agent": r.get("current_agent"),
            "filename": r.get("edital_filename"),
            "created_at": r["created_at"].isoformat() if hasattr(r.get("created_at"), "isoformat") else str(r.get("created_at", "")),
        }
        for r in rows
    ]


# ─────────────────────────── Histórico (BigQuery) ───────────────────────────

@lru_cache(maxsize=1)
def _bq() -> bigquery.Client:
    return bigquery.Client(project=DEST_PROJECT)


_FULL_TABLE = f"`{DEST_PROJECT}.{DEST_DATASET}.{DEST_TABLE}`"


@app.get("/analyses")
def historical_analyses(
    orgao: str | None = None,
    status: str | None = None,
    uf: str | None = None,
    since: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Lista análises persistidas no BigQuery."""
    where: list[str] = []
    params: list[bigquery.ScalarQueryParameter] = []
    if orgao:
        where.append("LOWER(orgao) LIKE LOWER(@orgao)")
        params.append(bigquery.ScalarQueryParameter("orgao", "STRING", f"%{orgao}%"))
    if status:
        where.append("status = @status")
        params.append(bigquery.ScalarQueryParameter("status", "STRING", status))
    if uf:
        where.append("uf = @uf")
        params.append(bigquery.ScalarQueryParameter("uf", "STRING", uf))
    if since:
        where.append("data_analise >= TIMESTAMP(@since)")
        params.append(bigquery.ScalarQueryParameter("since", "STRING", since))

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = (
        f"SELECT analysis_id, data_analise, orgao, uf, modalidade, objeto, status, "
        f"score_aderencia, bloqueio_camada_1, evidencias_count, requisitos_atendidos_count, "
        f"pipeline_ms, edital_filename "
        f"FROM {_FULL_TABLE} {where_sql} "
        f"ORDER BY data_analise DESC LIMIT @limit"
    )
    params.append(bigquery.ScalarQueryParameter("limit", "INT64", min(limit, 200)))
    job = _bq().query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params))
    return [dict(row) for row in job.result()]


@app.get("/analyses/{analysis_id}")
def historical_analysis(analysis_id: str) -> dict:
    """Detalhe completo de uma análise persistida."""
    sql = f"SELECT * FROM {_FULL_TABLE} WHERE analysis_id = @id LIMIT 1"
    job = _bq().query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("id", "STRING", analysis_id)]
        ),
    )
    rows = list(job.result())
    if not rows:
        raise HTTPException(status_code=404, detail="análise não encontrada")
    return dict(rows[0])


@app.delete("/analyses/{analysis_id}", status_code=204)
def delete_historical_analysis(analysis_id: str) -> None:
    """Hard delete de uma análise persistida no BigQuery."""
    sql = f"DELETE FROM {_FULL_TABLE} WHERE analysis_id = @id"
    job = _bq().query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("id", "STRING", analysis_id)]
        ),
    )
    job.result()
    if (job.num_dml_affected_rows or 0) == 0:
        raise HTTPException(status_code=404, detail="análise não encontrada")


class _BulkDeleteRequest(BaseModel):
    ids: list[str]


@app.post("/analyses/bulk_delete")
def bulk_delete_historical_analyses(body: _BulkDeleteRequest) -> dict:
    """Apaga múltiplas análises de uma vez."""
    ids = [i for i in (body.ids or []) if i]
    if not ids:
        return {"deleted": 0}
    sql = f"DELETE FROM {_FULL_TABLE} WHERE analysis_id IN UNNEST(@ids)"
    job = _bq().query(
        sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ArrayQueryParameter("ids", "STRING", ids)]
        ),
    )
    job.result()
    return {"deleted": int(job.num_dml_affected_rows or 0), "requested": len(ids)}


# ──────────────────────── Fase 5 — Análise Jurídica ─────────────────────────


def _run_juridico(analysis_id: str, bid_config: BidConfig | None = None) -> None:
    """Background task: executa o Analista Licitatório a partir do edital_json já armazenado."""
    from backend.agents.analista_licitatorio import analisar_juridico

    job = _get_job(analysis_id)
    if not job:
        return
    try:
        edital = EditalEstruturado.model_validate(job.edital_json)
        relatorio = analisar_juridico(
            edital,
            bid_config=bid_config,
            somatorio_drive=job.somatorio_drive_json,
            trace_id=analysis_id,
        )
        _touch(analysis_id, relatorio_juridico=relatorio, job_juridico_status="done")
        # Persiste no Postgres para sobreviver a restarts
        if job.pg_edital_id:
            try:
                from backend.tools.pg_tools import update_edital as _update_edital
                _update_edital(job.pg_edital_id, {
                    "relatorio_juridico_json": json.dumps(relatorio.model_dump(), ensure_ascii=False, default=str),
                    "analysis_id_juridica": analysis_id,
                })
            except Exception as pg_exc:  # noqa: BLE001
                log.warning("juridico.pg_persist_failed", extra={"error": str(pg_exc)})
        log.info(
            "juridico.done",
            extra={
                "lici_adk": {
                    "trace_id": analysis_id,
                    "score": relatorio.resumo_executivo.score_conformidade,
                    "nivel_risco": relatorio.risco_juridico.nivel_risco,
                }
            },
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("juridico.failed", extra={"lici_adk": {"trace_id": analysis_id}})
        _touch(analysis_id, job_juridico_status="failed", error_juridico=f"{type(exc).__name__}: {exc}")


@app.post("/editais/{analysis_id}/analise_juridica", status_code=202)
async def trigger_analise_juridica(
    analysis_id: str,
    background_tasks: BackgroundTasks,
    bid_config: BidConfig | None = None,
) -> dict:
    """Dispara análise jurídica on-demand para um edital já analisado comercialmente.

    Pré-requisito: POST /analyze deve ter sido concluído (status=done) para este analysis_id.
    Polling: GET /editais/{analysis_id}/analise_juridica
    """
    job = await asyncio.to_thread(_get_job, analysis_id)
    if not job:
        # Tenta reconstruir job a partir do Postgres (edital_id = analysis_id após container restart)
        try:
            pg_row = await asyncio.to_thread(get_edital, analysis_id)
        except Exception:
            pg_row = None
        if not pg_row:
            raise HTTPException(status_code=404, detail="analysis_id não encontrado")
        edital_json_stored = pg_row.get("edital_json_storage")
        result_json_stored = pg_row.get("result_json")
        relatorio_stored = pg_row.get("relatorio_juridico_json")
        # Se o relatório jurídico já está no Postgres, reconstrói como done
        if relatorio_stored:
            rel_data = json.loads(relatorio_stored) if isinstance(relatorio_stored, str) else relatorio_stored
            res_data = json.loads(result_json_stored) if result_json_stored and isinstance(result_json_stored, str) else (result_json_stored or {})
            edital_data = json.loads(edital_json_stored) if edital_json_stored and isinstance(edital_json_stored, str) else edital_json_stored
            await asyncio.to_thread(
                touch_job, analysis_id,
                status="done",
                edital_json=edital_data,
                result_json=res_data if res_data else None,
                relatorio_juridico_json=rel_data,
                job_juridico_status="done",
                pg_edital_id=str(pg_row["edital_id"]),
                edital_filename=pg_row.get("edital_filename"),
            )
            return {"analysis_id": analysis_id, "status": "done"}
        if not edital_json_stored or not result_json_stored:
            raise HTTPException(
                status_code=409,
                detail="Dados insuficientes para reanálise — processe o edital novamente para armazenar edital_json",
            )
        edital_json_data = json.loads(edital_json_stored) if isinstance(edital_json_stored, str) else edital_json_stored
        result_data = json.loads(result_json_stored) if isinstance(result_json_stored, str) else result_json_stored
        await asyncio.to_thread(
            touch_job, analysis_id,
            status="done",
            edital_json=edital_json_data,
            result_json=result_data,
            pg_edital_id=str(pg_row["edital_id"]),
            edital_filename=pg_row.get("edital_filename"),
        )
        job = await asyncio.to_thread(_get_job, analysis_id)
        if not job:
            raise HTTPException(status_code=500, detail="Falha ao reconstruir job — tente novamente")

    if job.status != "done":
        raise HTTPException(status_code=409, detail="análise comercial ainda não concluída — aguarde status=done")
    if not job.edital_json:
        raise HTTPException(status_code=409, detail="edital_json não disponível (pipeline mais antigo?)")
    if job.job_juridico_status == "done":
        return {"analysis_id": analysis_id, "status": "done"}
    if job.job_juridico_status == "running":
        return {"analysis_id": analysis_id, "status": "running", "message": "análise jurídica já em andamento"}

    _touch(analysis_id, job_juridico_status="running", error_juridico=None, relatorio_juridico=None)
    background_tasks.add_task(_run_juridico, analysis_id, bid_config)
    return {"analysis_id": analysis_id, "status": "running"}


@app.get("/editais/{analysis_id}/analise_juridica")
async def get_analise_juridica(analysis_id: str) -> dict:
    """Polling da análise jurídica. Retorna RelatorioLicitatorio quando status=done."""
    job = await asyncio.to_thread(_get_job, analysis_id)
    if not job:
        # Tenta reconstruir de Postgres (container restart)
        pg_row = await asyncio.to_thread(get_edital, analysis_id)
        if pg_row and pg_row.get("relatorio_juridico_json"):
            rel_stored = pg_row["relatorio_juridico_json"]
            rel_data = json.loads(rel_stored) if isinstance(rel_stored, str) else rel_stored
            edital_stored = pg_row.get("edital_json_storage")
            result_stored = pg_row.get("result_json")
            edital_data = json.loads(edital_stored) if edital_stored and isinstance(edital_stored, str) else edital_stored
            res_data = json.loads(result_stored) if result_stored and isinstance(result_stored, str) else (result_stored or {})
            await asyncio.to_thread(
                touch_job, analysis_id,
                status="done",
                edital_json=edital_data,
                result_json=res_data if res_data else None,
                relatorio_juridico_json=rel_data,
                job_juridico_status="done",
                pg_edital_id=str(pg_row["edital_id"]),
                edital_filename=pg_row.get("edital_filename"),
            )
            return {
                "analysis_id": analysis_id,
                "status": "done",
                "relatorio": rel_data,
            }
        raise HTTPException(status_code=404, detail="analysis_id não encontrado")
    if job.job_juridico_status == "not_started":
        return {"analysis_id": analysis_id, "status": "not_started"}
    if job.job_juridico_status == "running":
        return {"analysis_id": analysis_id, "status": "running"}
    if job.job_juridico_status == "failed":
        return {"analysis_id": analysis_id, "status": "failed", "error": job.error_juridico}
    return {
        "analysis_id": analysis_id,
        "status": "done",
        "relatorio": job.relatorio_juridico.model_dump() if job.relatorio_juridico else None,
    }


@app.get("/editais/{analysis_id}/kit_habilitacao")
async def get_kit_habilitacao(analysis_id: str) -> dict:
    """Retorna o Bloco 6 (KitHabilitacao) da análise jurídica quando disponível."""
    job = await asyncio.to_thread(_get_job, analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="analysis_id não encontrado")
    if job.job_juridico_status != "done" or not job.relatorio_juridico:
        raise HTTPException(status_code=404, detail="análise jurídica ainda não disponível")
    return job.relatorio_juridico.kit_habilitacao.model_dump()


@app.get("/editais/{analysis_id}/documentos")
async def list_documentos(analysis_id: str) -> dict:
    """Lista todos os documentos gerados: minutas (Bloco 4) + declarações padrão (Grupo B)."""
    from backend.agents.gerador_documentos import gerar_declaracoes, listar_tipos_disponiveis

    job = await asyncio.to_thread(_get_job, analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="analysis_id não encontrado")

    minutas: list[dict] = []
    if job.relatorio_juridico:
        for doc in job.relatorio_juridico.documentos_protocolo:
            minutas.append({
                "tipo": doc.tipo,
                "topico": doc.topico,
                "numero_clausula": doc.numero_clausula,
                "prazo_limite": doc.prazo_limite,
            })

    declaracoes_disponiveis = listar_tipos_disponiveis() if job.edital_json else []

    return {
        "analysis_id": analysis_id,
        "minutas_pre_sessao": minutas,
        "declaracoes_disponiveis": declaracoes_disponiveis,
    }


@app.get("/editais/{analysis_id}/documentos/{tipo}")
async def get_documento(analysis_id: str, tipo: str) -> dict:
    """Retorna texto pronto para copiar de um documento específico."""
    from backend.agents.gerador_documentos import gerar_declaracoes, listar_tipos_disponiveis

    job = await asyncio.to_thread(_get_job, analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="analysis_id não encontrado")

    if tipo in ("impugnacao", "esclarecimento") and job.relatorio_juridico:
        docs = [
            d for d in job.relatorio_juridico.documentos_protocolo
            if d.tipo == tipo.upper()
        ]
        if not docs:
            raise HTTPException(status_code=404, detail=f"nenhum documento do tipo {tipo} gerado")
        return {"tipo": tipo, "documentos": [d.model_dump() for d in docs]}

    if tipo == "kit":
        if not job.relatorio_juridico:
            raise HTTPException(status_code=404, detail="análise jurídica não disponível")
        return {"tipo": "kit", "kit_habilitacao": job.relatorio_juridico.kit_habilitacao.model_dump()}

    if tipo == "declaracoes" or tipo in listar_tipos_disponiveis():
        if not job.edital_json:
            raise HTTPException(status_code=409, detail="edital_json não disponível")
        edital = EditalEstruturado.model_validate(job.edital_json)
        condicionais = [tipo] if tipo not in ("declaracoes",) and tipo in listar_tipos_disponiveis() else None
        declaracoes = gerar_declaracoes(edital, incluir_condicionais=condicionais)
        if tipo != "declaracoes":
            texto = declaracoes.get(tipo)
            if not texto:
                raise HTTPException(status_code=404, detail=f"tipo de declaração desconhecido: {tipo}")
            return {"tipo": tipo, "texto": texto}
        return {"tipo": "declaracoes", "declaracoes": declaracoes}

    raise HTTPException(status_code=400, detail=f"tipo desconhecido: {tipo}. Use: impugnacao | esclarecimento | declaracoes | kit | <tipo_declaracao>")


# ──────────────────── Lote 1 — Drive Import endpoints ────────────────────────

class _DriveFileRequest(BaseModel):
    file_id: str
    orgao: str | None = None
    uf: str | None = None
    vendedor_email: str | None = None


class _DriveFolderRequest(BaseModel):
    folder_id: str
    orgao: str | None = None
    uf: str | None = None
    vendedor_email: str | None = None


def _download_drive_pdf(file_id: str) -> tuple[bytes, str]:
    """Baixa PDF do Drive via SA, retorna (pdf_bytes, filename)."""
    import io
    from googleapiclient.http import MediaIoBaseDownload
    from backend.tools.drive_tools import _drive_service

    svc = _drive_service()
    meta = svc.files().get(fileId=file_id, fields="name,mimeType,size").execute()
    if meta.get("mimeType") != "application/pdf":
        raise ValueError(f"Arquivo não é PDF: {meta.get('mimeType')}")
    size = int(meta.get("size", 0))
    if size > MAX_PDF_BYTES:
        raise ValueError(f"Arquivo excede {MAX_PDF_BYTES // (1024*1024)} MB")
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, svc.files().get_media(fileId=file_id))
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return fh.getvalue(), meta.get("name", f"{file_id}.pdf")


@app.post("/analyze/from-drive", status_code=202)
async def analyze_from_drive(body: _DriveFileRequest, background_tasks: BackgroundTasks) -> dict:
    """Analisa um PDF do Google Drive a partir do file_id."""
    try:
        pdf_bytes, filename = await asyncio.to_thread(_download_drive_pdf, body.file_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erro ao acessar Drive: {str(exc)[:200]}")

    import hashlib
    pdf_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    existing = await asyncio.to_thread(find_job_by_sha256, pdf_sha256)
    if existing:
        return {
            "analysis_id": existing["analysis_id"],
            "status": "already_exists",
            "pg_edital_id": existing.get("pg_edital_id"),
            "poll_url": f"/analyze/{existing['analysis_id']}",
        }

    analysis_id = str(uuid.uuid4())
    await asyncio.to_thread(create_job, analysis_id, filename, pdf_sha256)
    log.info("analyze.from_drive.queued", extra={"lici_adk": {"trace_id": analysis_id, "file_id": body.file_id}})
    background_tasks.add_task(_run_pipeline, analysis_id, pdf_bytes, filename)
    return {
        "analysis_id": analysis_id,
        "status": "queued",
        "estimated_seconds": 35,
        "poll_url": f"/analyze/{analysis_id}",
    }


def _list_drive_pdfs(folder_id: str) -> list[dict]:
    """Lista PDFs numa pasta do Drive. Retorna [{id, name}]."""
    from backend.tools.drive_tools import _drive_service, _list_pdfs
    svc = _drive_service()
    return _list_pdfs(svc, folder_id)


@app.post("/analyze/from-drive-folder", status_code=202)
async def analyze_from_drive_folder(body: _DriveFolderRequest, background_tasks: BackgroundTasks) -> dict:
    """Importa e analisa todos os PDFs de uma pasta do Google Drive.

    Retorna imediatamente com a lista de analysis_ids enfileirados.
    Cada job pode ser polled individualmente via GET /analyze/{id}.
    """
    try:
        files = await asyncio.to_thread(_list_drive_pdfs, body.folder_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erro ao listar pasta Drive: {str(exc)[:200]}")

    if not files:
        return {"queued": 0, "analysis_ids": [], "message": "Nenhum PDF encontrado na pasta"}

    import hashlib
    results = []
    for f in files:
        try:
            pdf_bytes, filename = await asyncio.to_thread(_download_drive_pdf, f["id"])
        except Exception as exc:
            log.warning("drive_folder.download_failed", extra={"file_id": f["id"], "error": str(exc)})
            results.append({"file_id": f["id"], "filename": f.get("name"), "status": "download_failed"})
            continue

        pdf_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        existing = await asyncio.to_thread(find_job_by_sha256, pdf_sha256)
        if existing:
            results.append({
                "file_id": f["id"],
                "filename": filename,
                "analysis_id": existing["analysis_id"],
                "status": "already_exists",
            })
            continue

        analysis_id = str(uuid.uuid4())
        await asyncio.to_thread(create_job, analysis_id, filename, pdf_sha256)
        background_tasks.add_task(_run_pipeline, analysis_id, pdf_bytes, filename)
        results.append({
            "file_id": f["id"],
            "filename": filename,
            "analysis_id": analysis_id,
            "status": "queued",
        })

    queued = sum(1 for r in results if r["status"] == "queued")
    log.info("analyze.from_drive_folder.queued", extra={"lici_adk": {"folder_id": body.folder_id, "queued": queued}})
    return {"queued": queued, "total_files": len(files), "analysis_ids": results}


# ──────────────────────── Drive re-scan (Cloud Scheduler) ────────────────────

class _RescanRequest(BaseModel):
    edital_id: str | None = None  # None → invalida todo o cache


@app.post("/internal/drive/rescan", status_code=200)
async def drive_rescan(body: _RescanRequest | None = None) -> dict:
    """Invalida cache de atestados Drive.

    Chamado pelo Cloud Scheduler a cada 15 min.
    - `edital_id` fornecido → invalida apenas aquele edital.
    - Sem body ou `edital_id=null` → invalida TODOS (full rescan).
    Exige que o caller seja a Cloud Run SA (OIDC) por convenção;
    a proteção é garantida pelo IAM do Cloud Run (não pública).
    """
    if body and body.edital_id:
        deleted = await asyncio.to_thread(invalidate_cache, body.edital_id)
        return {"invalidated": 1 if deleted else 0, "edital_id": body.edital_id}
    count = await asyncio.to_thread(invalidate_all_cache)
    log.info("drive_rescan.full", extra={"rows_deleted": count})
    return {"invalidated": count, "edital_id": None}


# ──────────────────────── Importar de URL pública ────────────────────────────

_KNOWN_PORTALS: dict[str, str] = {
    "www.comprasnet.gov.br": "Comprasnet",
    "comprasnet.gov.br": "Comprasnet",
    "pncp.gov.br": "PNCP",
    "www.pncp.gov.br": "PNCP",
    "www.bec.sp.gov.br": "BEC-SP",
    "bec.sp.gov.br": "BEC-SP",
    "licitacoes-e.bb.com.br": "Licitações-e",
    "www.licitacoes-e.bb.com.br": "Licitações-e",
}
_MAX_PDF_BYTES_URL = 30 * 1024 * 1024  # 30MB


class _UrlRequest(BaseModel):
    url: str
    orgao: str | None = None
    uf: str | None = None
    vendedor_email: str | None = None


@app.post("/analyze/from-url", status_code=202)
async def analyze_from_url(body: _UrlRequest, background_tasks: BackgroundTasks) -> dict:
    """Baixa e analisa um PDF a partir de URL pública (Comprasnet, PNCP, BEC-SP …)."""
    import hashlib
    from urllib.parse import urlparse

    parsed = urlparse(body.url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=422, detail="URL deve começar com http:// ou https://")

    portal = _KNOWN_PORTALS.get(parsed.hostname or "", None)

    try:
        async with httpx.AsyncClient(
            timeout=30,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; LiciADK/1.0; +https://xertica.com)",
                "Accept": "application/pdf,*/*",
            },
        ) as client:
            resp = await client.get(body.url)
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise HTTPException(
                status_code=422,
                detail=f"Portal exige autenticação (baixe manualmente e use a aba PDF). Portal: {portal or parsed.hostname}",
            )
        raise HTTPException(status_code=502, detail=f"Erro HTTP {exc.response.status_code} ao baixar URL")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Erro de rede: {str(exc)[:200]}")

    content_type = resp.headers.get("content-type", "").lower()
    if "pdf" not in content_type and not body.url.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=415,
            detail=f"URL não retornou um PDF (Content-Type: {content_type}). Use a aba PDF para arquivos locais.",
        )

    pdf_bytes = resp.content
    if len(pdf_bytes) > _MAX_PDF_BYTES_URL:
        raise HTTPException(status_code=413, detail=f"PDF excede 30 MB ({len(pdf_bytes)//1024//1024} MB)")

    pdf_sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    existing = await asyncio.to_thread(find_job_by_sha256, pdf_sha256)
    if existing:
        return {
            "analysis_id": existing["analysis_id"],
            "status": "already_exists",
            "pg_edital_id": existing.get("pg_edital_id"),
            "poll_url": f"/analyze/{existing['analysis_id']}",
        }

    # Derive filename from URL path
    url_path = parsed.path.rstrip("/")
    filename = url_path.split("/")[-1] if url_path else "edital.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"

    analysis_id = str(uuid.uuid4())
    await asyncio.to_thread(create_job, analysis_id, filename, pdf_sha256)

    log.info(
        "analyze.from_url.queued",
        extra={"lici_adk": {"trace_id": analysis_id, "url": body.url[:200], "portal": portal}},
    )
    background_tasks.add_task(_run_pipeline, analysis_id, pdf_bytes, filename)
    return {
        "analysis_id": analysis_id,
        "status": "queued",
        "portal": portal,
        "estimated_seconds": 35,
        "poll_url": f"/analyze/{analysis_id}",
    }


# ──────────────────────── Fase 6 — Sistema de Controle de Editais ────────────

class _CriarEditalRequest(BaseModel):
    orgao: str = ""
    uf: str = "XX"
    uasg: str | None = None
    numero_pregao: str | None = None
    portal: str | None = None
    objeto: str | None = None
    valor_estimado: float | None = None
    data_encerramento: str | None = None  # ISO string
    vendedor_email: str | None = None
    drive_folder_id: str | None = None
    drive_folder_url: str | None = None
    prioridade: int = 3
    criado_por: str = "sistema"


class _PatchEditalRequest(BaseModel):
    orgao: str | None = None
    uf: str | None = None
    uasg: str | None = None
    numero_pregao: str | None = None
    portal: str | None = None
    objeto: str | None = None
    valor_estimado: float | None = None
    data_encerramento: str | None = None
    fase_atual: str | None = None
    estado_terminal: str | None = None
    vendedor_email: str | None = None
    drive_folder_id: str | None = None
    drive_folder_url: str | None = None
    classificacao: str | None = None
    risco: str | None = None
    prioridade: int | None = None
    motivo_movimentacao: str | None = None
    autor_email: str = "sistema"


def _serialize_edital(row: dict) -> dict:
    """Converte tipos Postgres para JSON-safe."""
    import decimal
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif isinstance(v, decimal.Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


def _get_edital_by_analysis_id(analysis_id: str) -> dict | None:
    """Busca edital pelo campo analysis_id_comercial (fallback para lookup por UUID do job)."""
    from backend.tools.pg_tools import get_engine
    from sqlalchemy import text as _text
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            _text("SELECT * FROM editais WHERE analysis_id_comercial = :aid AND deleted_at IS NULL LIMIT 1"),
            {"aid": analysis_id},
        ).fetchone()
    return dict(row._mapping) if row else None


@app.post("/editais", status_code=201)
async def criar_edital(body: _CriarEditalRequest) -> dict:
    """Cria um registro de edital no sistema de controle (sem PDF)."""
    data = {k: v for k, v in body.model_dump().items() if v is not None and k != "criado_por"}
    data["criado_por"] = body.criado_por
    data["fase_atual"] = "identificacao"
    row = await asyncio.to_thread(create_edital, data)
    # Seed gates do stage inicial
    await asyncio.to_thread(seed_gates, str(row["edital_id"]), "identificacao")
    return _serialize_edital(row)


@app.get("/editais")
async def listar_editais(
    fase: str | None = None,
    uf: str | None = None,
    vendedor_email: str | None = None,
    limit: int = 50,
) -> list[dict]:
    rows = await asyncio.to_thread(list_editais, fase, uf, vendedor_email, limit)
    return [_serialize_edital(r) for r in rows]


@app.get("/editais/{edital_id_or_analysis_id}")
async def get_edital_detail(edital_id_or_analysis_id: str) -> dict:
    """Retorna edital + comentários + gates. Aceita tanto edital_id (UUID Postgres) quanto analysis_id_comercial."""
    # Primeiro tenta como edital_id no Postgres
    row = await asyncio.to_thread(get_edital, edital_id_or_analysis_id)
    # Fallback: tenta buscar por analysis_id_comercial
    if not row:
        row = await asyncio.to_thread(_get_edital_by_analysis_id, edital_id_or_analysis_id)
    if row:        eid = str(row["edital_id"])
        comentarios = await asyncio.to_thread(list_comentarios, eid)
        gates = await asyncio.to_thread(list_gates, eid)
        movs = await asyncio.to_thread(list_movimentacoes, eid)
        serialized = _serialize_edital(row)
        # Desserializa result_json e relatorio_juridico_json armazenados como JSONB
        if serialized.get("result_json"):
            v = serialized["result_json"]
            serialized["result"] = json.loads(v) if isinstance(v, str) else v
            del serialized["result_json"]
        if serialized.get("relatorio_juridico_json"):
            v = serialized["relatorio_juridico_json"]
            serialized["relatorio_juridico"] = json.loads(v) if isinstance(v, str) else v
            del serialized["relatorio_juridico_json"]
        return {
            **serialized,
            "comentarios": [_serialize_edital(c) for c in comentarios],
            "gates": [_serialize_edital(g) for g in gates],
            "movimentacoes": [_serialize_edital(m) for m in movs],
        }
    # 404 — log para diagnóstico (analysis_id stale, race condition, etc.)
    job_row = await asyncio.to_thread(get_job, edital_id_or_analysis_id)
    log.warning(
        "editais.lookup_404",
        extra={"lici_adk": {
            "lookup_id": edital_id_or_analysis_id,
            "found_in_jobs": bool(job_row),
            "job_status": job_row.get("status") if job_row else None,
            "job_pg_edital_id": job_row.get("pg_edital_id") if job_row else None,
        }},
    )
    raise HTTPException(status_code=404, detail="edital não encontrado")


@app.patch("/editais/{edital_id}")
async def patch_edital(edital_id: str, body: _PatchEditalRequest) -> dict:
    """Atualiza campos do edital. Se fase_atual mudar, registra movimentação e semeia gates."""
    # Busca estado atual
    current = await asyncio.to_thread(get_edital, edital_id)
    if not current:
        raise HTTPException(status_code=404, detail="edital não encontrado")

    # Valida nova fase
    if body.fase_atual and body.fase_atual not in STAGES_ORDER:
        raise HTTPException(status_code=400, detail=f"fase_atual inválida. Válidas: {STAGES_ORDER}")
    if body.estado_terminal and body.estado_terminal not in ESTADOS_TERMINAIS:
        raise HTTPException(status_code=400, detail=f"estado_terminal inválido. Válidos: {ESTADOS_TERMINAIS}")

    fase_origem = current["fase_atual"]
    data = {k: v for k, v in body.model_dump(exclude={"motivo_movimentacao", "autor_email"}).items() if v is not None}

    row = await asyncio.to_thread(update_edital, edital_id, data)
    if not row:
        raise HTTPException(status_code=404, detail="edital não encontrado")

    # Se mudou de fase, registra movimentação + semeia gates do novo stage
    if body.fase_atual and body.fase_atual != fase_origem:
        await asyncio.to_thread(
            add_movimentacao, edital_id, fase_origem, body.fase_atual,
            body.autor_email, body.motivo_movimentacao
        )
        await asyncio.to_thread(seed_gates, edital_id, body.fase_atual)

    return _serialize_edital(row)


@app.delete("/editais/{edital_id}", status_code=204)
async def delete_edital(edital_id: str) -> None:
    ok = await asyncio.to_thread(soft_delete_edital, edital_id)
    if not ok:
        raise HTTPException(status_code=404, detail="edital não encontrado")


class _BulkDeleteEditaisRequest(BaseModel):
    ids: list[str]


@app.post("/editais/bulk_delete")
async def bulk_delete_editais(body: _BulkDeleteEditaisRequest) -> dict:
    """Soft delete em lote de editais."""
    ids = [i for i in (body.ids or []) if i]
    if not ids:
        return {"deleted": 0, "requested": 0}
    results = await asyncio.gather(*[asyncio.to_thread(soft_delete_edital, i) for i in ids])
    deleted = sum(1 for ok in results if ok)
    return {"deleted": deleted, "requested": len(ids)}


class _ComentarioRequest(BaseModel):
    texto: str
    autor_email: str = "sistema"
    mencionados: list[str] = []


# ── Notificação por e-mail via Apps Script (background, não bloqueia response) ─

async def _notify_comment(edital_id: str, autor_email: str, texto: str) -> None:
    """Dispara webhook para Apps Script após novo comentário.

    Feature-flagged: se LICI_APPS_SCRIPT_WEBHOOK_URL não estiver definido, silencia.
    """
    apps_script_url = os.getenv("LICI_APPS_SCRIPT_WEBHOOK_URL")
    webhook_secret = os.getenv("LICI_APPS_SCRIPT_SECRET", "")
    if not apps_script_url:
        return

    try:
        edital = await asyncio.to_thread(get_edital, edital_id)
        if not edital:
            return

        # Coleta destinatários: comentadores anteriores + vendedor_email, exceto autor
        rows = await asyncio.to_thread(list_comentarios, edital_id)
        recipients: set[str] = {r["autor_email"] for r in rows if r.get("autor_email") and r["autor_email"] != autor_email}
        if edital.get("vendedor_email") and edital["vendedor_email"] != autor_email:
            recipients.add(edital["vendedor_email"])

        if not recipients:
            return

        base_url = os.getenv("LICI_BASE_URL", "https://lici.example.com")
        payload = {
            "secret":     webhook_secret,
            "to":         ", ".join(sorted(recipients)),
            "subject":    f"[Lici] Novo comentário — {edital.get('orgao', 'Edital')}",
            "user":       autor_email.split("@")[0],
            "editalName": edital.get("orgao", "Edital"),
            "comment":    texto[:300],
            "link":       f"{base_url}/edital/{edital_id}#comentarios",
        }

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(apps_script_url, json=payload)
            resp.raise_for_status()
        log.info("notify_comment.sent", extra={"edital_id": edital_id, "recipients": len(recipients)})
    except Exception as exc:
        log.warning("notify_comment.failed", extra={"error": str(exc)[:200]})


@app.post("/editais/{edital_id}/comentarios", status_code=201)
async def post_comentario(edital_id: str, body: _ComentarioRequest, background_tasks: BackgroundTasks) -> dict:
    current = await asyncio.to_thread(get_edital, edital_id)
    if not current:
        raise HTTPException(status_code=404, detail="edital não encontrado")
    row = await asyncio.to_thread(add_comentario, edital_id, body.autor_email, body.texto, body.mencionados)
    background_tasks.add_task(_notify_comment, edital_id, body.autor_email, body.texto)
    return _serialize_edital(row)


@app.get("/editais/{edital_id}/comentarios")
async def get_comentarios(edital_id: str) -> list[dict]:
    current = await asyncio.to_thread(get_edital, edital_id)
    if not current:
        raise HTTPException(status_code=404, detail="edital não encontrado")
    rows = await asyncio.to_thread(list_comentarios, edital_id)
    return [_serialize_edital(r) for r in rows]


@app.get("/editais/{edital_id}/gates")
async def get_gates(edital_id: str, stage: str | None = None) -> list[dict]:
    current = await asyncio.to_thread(get_edital, edital_id)
    if not current:
        raise HTTPException(status_code=404, detail="edital não encontrado")
    rows = await asyncio.to_thread(list_gates, edital_id, stage)
    return [_serialize_edital(r) for r in rows]


class _GatePatchRequest(BaseModel):
    concluido: bool
    autor_email: str = "sistema"


@app.patch("/editais/{edital_id}/gates/{gate_key}")
async def patch_gate(edital_id: str, gate_key: str, body: _GatePatchRequest) -> dict:
    current = await asyncio.to_thread(get_edital, edital_id)
    if not current:
        raise HTTPException(status_code=404, detail="edital não encontrado")
    stage = current["fase_atual"]
    row = await asyncio.to_thread(set_gate, edital_id, stage, gate_key, body.concluido, body.autor_email)
    if not row:
        raise HTTPException(status_code=404, detail=f"gate '{gate_key}' não encontrado para stage '{stage}'")
    return _serialize_edital(row)


# ─────────────────────────── Histórico do órgão ──────────────────────────────

@app.get("/editais/{edital_id}/historico-orgao")
async def get_historico_orgao_endpoint(edital_id: str) -> dict:
    edital = await asyncio.to_thread(get_edital, edital_id)
    if not edital:
        raise HTTPException(status_code=404, detail="edital não encontrado")
    orgao = edital.get("orgao", "")
    if not orgao:
        return {"orgao": "", "participacoes": [], "win_rate": None, "score_medio": None}
    rows = await asyncio.to_thread(get_historico_orgao, orgao, edital_id)
    ganhos = sum(1 for r in rows if r.get("estado_terminal") == "ganho")
    win_rate = round(ganhos / len(rows) * 100) if rows else None
    scores = [float(r["score_comercial"]) for r in rows if r.get("score_comercial") is not None]
    score_medio = round(sum(scores) / len(scores), 1) if scores else None
    return {
        "orgao": orgao,
        "participacoes": [_serialize_edital(r) for r in rows],
        "win_rate": win_rate,
        "score_medio": score_medio,
    }


# ─────────────────────────── Bulk update de editais ───────────────────────────

class _BulkUpdateRequest(BaseModel):
    ids: list[str]
    vendedor_email: str | None = None
    prioridade: int | None = None
    fase_atual: str | None = None
    classificacao: str | None = None
    risco: str | None = None


@app.post("/editais/bulk_update")
async def bulk_update_editais_endpoint(body: _BulkUpdateRequest) -> dict:
    ids = [i for i in (body.ids or []) if i]
    if not ids:
        return {"updated": 0, "requested": 0}
    fields = {k: v for k, v in body.model_dump(exclude={"ids"}).items() if v is not None}
    if not fields:
        return {"updated": 0, "requested": len(ids), "message": "Nenhum campo para atualizar"}
    updated = await asyncio.to_thread(bulk_update_editais, ids, fields)
    return {"updated": updated, "requested": len(ids)}


# ────────────────────────── Notificações in-app ──────────────────────────────

@app.get("/notifications")
async def get_notifications(
    user_email: str,
    unread: bool = False,
    limit: int = 30,
) -> list[dict]:
    """Lista notificações do usuário. Passa ?unread=true para apenas não lidas."""
    rows = await asyncio.to_thread(list_notifications, user_email, unread, limit)
    return [_serialize_edital(r) for r in rows]


@app.post("/notifications/read")
async def mark_read(
    user_email: str,
    ids: list[str] | None = None,
) -> dict:
    """Marca notificações como lidas. Se ids=None, marca todas do usuário."""
    count = await asyncio.to_thread(mark_notifications_read, user_email, ids)
    return {"marked_read": count}


# ────────────────────────── Webhook ingest ───────────────────────────────────

class _WebhookIngestRequest(BaseModel):
    pdf_url: str | None = None
    drive_file_id: str | None = None
    pdf_base64: str | None = None
    orgao: str | None = None
    uf: str | None = None
    vendedor_email: str | None = None


@app.post("/webhooks/ingest", status_code=202)
async def webhook_ingest(
    background_tasks: BackgroundTasks,
    body: _WebhookIngestRequest,
    x_webhook_secret: str | None = Header(None, alias="X-Webhook-Secret"),
) -> dict:
    """Dispara ingestão via webhook externo. Protegido por LICI_WEBHOOK_SECRET."""
    expected = os.getenv("LICI_WEBHOOK_SECRET", "")
    if expected and x_webhook_secret != expected:
        raise HTTPException(status_code=401, detail="webhook secret inválido")

    if not any([body.pdf_url, body.drive_file_id, body.pdf_base64]):
        raise HTTPException(status_code=422, detail="Forneça pdf_url, drive_file_id ou pdf_base64")

    async def _run():
        try:
            if body.drive_file_id:
                r = await _client.post(
                    f"{_SELF_BASE}/upload/drive",
                    json={"file_id": body.drive_file_id, "orgao": body.orgao, "uf": body.uf,
                          "vendedor_email": body.vendedor_email},
                )
            elif body.pdf_url:
                r = await _client.post(
                    f"{_SELF_BASE}/upload/url",
                    json={"url": body.pdf_url, "orgao": body.orgao, "uf": body.uf,
                          "vendedor_email": body.vendedor_email},
                )
            else:
                # base64 → upload bytes
                import base64
                pdf_bytes = base64.b64decode(body.pdf_base64)
                from io import BytesIO
                files = {"file": ("webhook.pdf", BytesIO(pdf_bytes), "application/pdf")}
                data = {k: v for k, v in [("orgao", body.orgao), ("uf", body.uf),
                                           ("vendedor_email", body.vendedor_email)] if v}
                r = await _client.post(f"{_SELF_BASE}/upload", files=files, data=data)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            logger.error("webhook_ingest background error: %s", exc)

    background_tasks.add_task(_run)
    return {"queued": True}

# ────────────────────────────── Chat Agêntico ─────────────────────────────────

class _ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str

class _ChatRequest(BaseModel):
    messages: list[_ChatMessage]  # histórico completo incluindo a última mensagem do user

class _ChatResponse(BaseModel):
    reply: str
    messages: list[_ChatMessage]  # histórico atualizado para o cliente cachear

@app.post("/chat")
async def chat_endpoint(body: _ChatRequest) -> _ChatResponse:
    """Chat agêntico com acesso a atestados, contratos, análises e pipeline."""
    from backend.agents.chat_agent import chat as _chat

    if not body.messages:
        raise HTTPException(status_code=400, detail="messages não pode ser vazio")

    last = body.messages[-1]
    if last.role != "user":
        raise HTTPException(status_code=400, detail="última mensagem deve ser do usuário")

    msgs = [m.model_dump() for m in body.messages]
    try:
        reply, updated = await asyncio.to_thread(_chat, msgs)
    except Exception as exc:
        log.exception("chat.endpoint_error")
        raise HTTPException(status_code=500, detail=f"Erro no agente: {str(exc)[:300]}")

    return _ChatResponse(
        reply=reply,
        messages=[_ChatMessage(**m) for m in updated],
    )


# ────────────────────── Chat Sessões (histórico persistente) ──────────────────

from fastapi import Form, UploadFile as _UploadFile
from backend.tools.chat_store import (
    create_session as _cs_create,
    list_sessions as _cs_list,
    get_session as _cs_get_plain,
    get_session_with_messages as _cs_get,
    delete_session as _cs_delete,
    add_message as _cs_add_msg,
    get_messages as _cs_get_msgs,
    update_session_title as _cs_retitle,
)


def _edital_context_str(edital_id: str) -> str | None:
    """Monta string de contexto do edital para injetar no system prompt."""
    try:
        row = get_edital(edital_id)
        if not row:
            return None
        parts = [f"Edital: {row.get('orgao', '')} ({row.get('uf', '')})"]
        if row.get("objeto"):
            parts.append(f"Objeto: {row['objeto']}")
        if row.get("fase_atual"):
            parts.append(f"Fase atual: {row['fase_atual']}")
        if row.get("score_comercial") is not None:
            import decimal
            parts.append(f"Score comercial: {float(row['score_comercial']):.0f}%")
        if row.get("valor_estimado"):
            parts.append(f"Valor estimado: R$ {float(row['valor_estimado']):,.2f}")
        if row.get("data_encerramento"):
            parts.append(f"Encerramento: {row['data_encerramento']}")
        return "\n".join(parts)
    except Exception:
        return None


@app.get("/chat/sessions")
async def list_chat_sessions(limit: int = 60) -> list[dict]:
    return await asyncio.to_thread(_cs_list, limit)


@app.post("/chat/sessions/{session_id}/upload_edital", status_code=202)
async def upload_edital_in_chat(
    session_id: str,
    background_tasks: BackgroundTasks,
    file: _UploadFile = File(...),
) -> dict:
    """Recebe PDF de edital enviado pelo chat, inicia pipeline completo e vincula sessão."""
    sess = await asyncio.to_thread(_cs_get_plain, session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="sessão não encontrada")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="arquivo deve ser .pdf")
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF vazio")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail=f"PDF excede {MAX_PDF_BYTES//(1024*1024)}MB")

    import hashlib as _hl
    pdf_sha256 = _hl.sha256(pdf_bytes).hexdigest()
    existing = await asyncio.to_thread(find_job_by_sha256, pdf_sha256)
    if existing:
        return {"analysis_id": existing["analysis_id"], "status": "already_exists", "poll_url": f"/analyze/{existing['analysis_id']}"}

    analysis_id = str(uuid.uuid4())
    await asyncio.to_thread(create_job, analysis_id, file.filename or "edital.pdf", pdf_sha256)

    await asyncio.to_thread(
        _cs_add_msg, session_id, "assistant",
        f"📄 Recebi **{file.filename}**. O pipeline completo foi iniciado — extrai dados, verifica aptidão técnica e cruza com atestados. Leva ≈35s. Resultado aparece aqui quando terminar!",
    )

    def _run_and_link(aid: str, pb: bytes, fname: str, sid: str) -> None:
        _run_pipeline(aid, pb, fname)
        job = _get_job(aid)
        if not job:
            return
        if job.pg_edital_id:
            try:
                from sqlalchemy import text as _sqlt
                eng = get_engine()
                with eng.connect() as conn:
                    conn.execute(
                        _sqlt("UPDATE chat_sessions SET edital_id = :eid, updated_at = NOW() WHERE session_id = :sid"),
                        {"eid": job.pg_edital_id, "sid": sid},
                    )
                    conn.commit()
                orgao = (job.edital_json or {}).get("orgao", "edital")
                score = job.result.score_aderencia if job.result else None
                score_str = f" | Score: **{score:.0f}%**" if score is not None else ""
                status_str = f"**{job.result.status}**" if job.result and job.result.status else "análise concluída"
                _cs_add_msg(
                    sid, "assistant",
                    f"✅ **Pipeline concluído!** Edital de **{orgao}** — {status_str}{score_str}\n\n"
                    f"Agora posso responder sobre aptidão técnica, atestados necessários, gaps e estratégia. "
                    f"Clique em **'ver edital'** no topo para o relatório completo!",
                )
            except Exception as link_exc:
                log.warning(f"upload_edital_in_chat.link_failed: {link_exc}")
                _cs_add_msg(sid, "assistant", "⚠️ Pipeline concluído, mas erro ao vincular o edital. Acesse em Pipeline.")
        elif job.status == "failed":
            _cs_add_msg(sid, "assistant", f"❌ Pipeline falhou: {job.error or 'erro desconhecido'}. Tente novamente.")

    background_tasks.add_task(_run_and_link, analysis_id, pdf_bytes, file.filename or "edital.pdf", session_id)
    return {"analysis_id": analysis_id, "status": "queued", "poll_url": f"/analyze/{analysis_id}"}


@app.post("/chat/sessions", status_code=201)
async def create_chat_session(
    title: str = "Nova conversa",
    edital_id: str | None = None,
    user_email: str | None = None,
) -> dict:
    return await asyncio.to_thread(_cs_create, title, edital_id, user_email)


@app.get("/chat/sessions/{session_id}")
async def get_chat_session(session_id: str) -> dict:
    result = await asyncio.to_thread(_cs_get, session_id)
    if not result:
        raise HTTPException(status_code=404, detail="sessão não encontrada")
    return result


@app.delete("/chat/sessions/{session_id}", status_code=204)
async def delete_chat_session(session_id: str) -> None:
    ok = await asyncio.to_thread(_cs_delete, session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="sessão não encontrada")


@app.patch("/chat/sessions/{session_id}/title")
async def rename_chat_session(session_id: str, title: str) -> dict:
    await asyncio.to_thread(_cs_retitle, session_id, title)
    return {"session_id": session_id, "title": title}


@app.post("/chat/sessions/{session_id}/messages/stream")
async def send_session_message_stream(
    session_id: str,
    text: str = Form(...),
    files: list[_UploadFile] = File(default=[]),
):
    """SSE streaming version of the chat message endpoint.
    Yields text/event-stream events as the agent processes and responds.
    Tool-calling loop runs synchronously; final text is streamed word-by-word.
    """
    from fastapi.responses import StreamingResponse as _StreamingResponse
    from backend.agents.chat_agent import chat_session as _chat_session

    session = await asyncio.to_thread(_cs_get, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="sessão não encontrada")

    file_parts: list[dict] = []
    attachments_meta: list[dict] = []
    MAX_FILE_BYTES = 20 * 1024 * 1024

    for f in files:
        if not f.filename:
            continue
        data = await f.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"Arquivo {f.filename} excede 20 MB")
        mime = f.content_type or "application/octet-stream"
        allowed = ("image/", "application/pdf", "text/plain")
        if not any(mime.startswith(a) for a in allowed):
            raise HTTPException(status_code=415, detail=f"Tipo não suportado: {mime}")
        file_parts.append({"mime_type": mime, "data": data})
        attachments_meta.append({"filename": f.filename, "mime_type": mime, "size": len(data)})

    history_msgs = [{"role": m["role"], "content": m["content"]} for m in session["messages"]]

    edital_ctx: str | None = None
    if session.get("edital_id"):
        edital_ctx = await asyncio.to_thread(_edital_context_str, str(session["edital_id"]))

    attach_meta_for_db = attachments_meta if attachments_meta else None
    file_names = [a["filename"] for a in attachments_meta]
    user_content = text
    if file_names:
        user_content = f"[Arquivos: {', '.join(file_names)}]\n{text}"

    await asyncio.to_thread(_cs_add_msg, session_id, "user", user_content, attach_meta_for_db)

    # Run agent synchronously in thread (tool-calling loop)
    try:
        reply = await asyncio.to_thread(
            _chat_session,
            history_msgs,
            text,
            file_parts if file_parts else None,
            edital_ctx,
        )
    except Exception as exc:
        log.exception("chat_session_stream.agent_error")

        async def _error_stream():
            yield f"data: {json.dumps({'error': str(exc)[:300]})}\n\n"

        return _StreamingResponse(_error_stream(), media_type="text/event-stream")

    msg_row = await asyncio.to_thread(_cs_add_msg, session_id, "assistant", reply)
    message_id = str(msg_row.get("message_id", ""))

    if len(history_msgs) == 0:
        short_title = text[:60].strip()
        if short_title:
            await asyncio.to_thread(_cs_retitle, session_id, short_title)

    async def event_stream():
        # Stream response word-by-word for progressive display
        words = reply.split(" ")
        chunk_size = 4
        for i in range(0, len(words), chunk_size):
            chunk = " ".join(words[i : i + chunk_size])
            if i + chunk_size < len(words):
                chunk += " "
            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            await asyncio.sleep(0.025)
        yield f"data: {json.dumps({'done': True, 'message_id': message_id})}\n\n"

    return _StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/chat/sessions/{session_id}/messages")
async def send_session_message(
    session_id: str,
    text: str = Form(...),
    files: list[_UploadFile] = File(default=[]),
) -> dict:
    """Envia mensagem (com arquivos opcionais) em uma sessão persistida."""
    from backend.agents.chat_agent import chat_session as _chat_session

    # Verifica que a sessão existe
    session = await asyncio.to_thread(_cs_get, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="sessão não encontrada")

    # Processa arquivos (imagens + PDFs passados diretamente ao Gemini)
    file_parts: list[dict] = []
    attachments_meta: list[dict] = []
    MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB

    for f in files:
        if not f.filename:
            continue
        data = await f.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"Arquivo {f.filename} excede 20 MB")
        mime = f.content_type or "application/octet-stream"
        # Só aceita tipos que Gemini suporta
        allowed = ("image/", "application/pdf", "text/plain")
        if not any(mime.startswith(a) for a in allowed):
            raise HTTPException(status_code=415, detail=f"Tipo não suportado: {mime}. Use imagens, PDF ou texto.")
        file_parts.append({"mime_type": mime, "data": data})
        attachments_meta.append({"filename": f.filename, "mime_type": mime, "size": len(data)})

    # Histórico anterior como lista de dicts simples
    history_msgs = [{"role": m["role"], "content": m["content"]} for m in session["messages"]]

    # Contexto do edital vinculado (se houver)
    edital_ctx: str | None = None
    if session.get("edital_id"):
        edital_ctx = await asyncio.to_thread(_edital_context_str, str(session["edital_id"]))

    # Persiste mensagem do usuário
    attach_meta_for_db = attachments_meta if attachments_meta else None
    file_names = [a["filename"] for a in attachments_meta]
    user_content = text
    if file_names:
        user_content = f"[Arquivos: {', '.join(file_names)}]\n{text}"

    await asyncio.to_thread(_cs_add_msg, session_id, "user", user_content, attach_meta_for_db)

    # Chama o agente (em thread)
    try:
        reply = await asyncio.to_thread(
            _chat_session,
            history_msgs,
            text,
            file_parts if file_parts else None,
            edital_ctx,
        )
    except Exception as exc:
        log.exception("chat_session.agent_error")
        raise HTTPException(status_code=500, detail=f"Erro no agente: {str(exc)[:300]}")

    # Persiste resposta do assistente
    msg_row = await asyncio.to_thread(_cs_add_msg, session_id, "assistant", reply)

    # Auto-titulo na primeira mensagem
    if len(history_msgs) == 0:
        short_title = text[:60].strip()
        if short_title:
            await asyncio.to_thread(_cs_retitle, session_id, short_title)

    return {"reply": reply, "message_id": str(msg_row.get("message_id", ""))}


# ────────────────────── Chat ↔ Edital Link ────────────────────────────────────

class _LinkEditalBody(BaseModel):
    edital_id: str | None = None  # None = unlink


@app.patch("/chat/sessions/{session_id}/link-edital")
async def link_session_to_edital(session_id: str, body: _LinkEditalBody) -> dict:
    """Vincula (ou desvincula) uma sessão de chat a um edital específico."""
    from sqlalchemy import text as _sqlt
    engine = get_engine()

    # Validate session exists
    sess = await asyncio.to_thread(_cs_get_plain, session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="sessão não encontrada")

    # Validate edital if provided
    if body.edital_id:
        edital = await asyncio.to_thread(get_edital, body.edital_id)
        if not edital:
            raise HTTPException(status_code=404, detail="edital não encontrado")

    def _update():
        with engine.connect() as conn:
            conn.execute(
                _sqlt("UPDATE chat_sessions SET edital_id = :eid, updated_at = NOW() WHERE session_id = :sid"),
                {"eid": body.edital_id, "sid": session_id},
            )
            conn.commit()

    await asyncio.to_thread(_update)
    return {"session_id": session_id, "edital_id": body.edital_id, "linked": body.edital_id is not None}


@app.get("/editais/{edital_id}/chat-sessions")
async def list_edital_chat_sessions(edital_id: str) -> list[dict]:
    """Lista sessões de chat vinculadas a um edital."""
    from sqlalchemy import text as _sqlt
    engine = get_engine()

    def _fetch():
        with engine.connect() as conn:
            rows = conn.execute(
                _sqlt(
                    "SELECT session_id::text, title, created_at, updated_at, "
                    "(SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.session_id) AS message_count "
                    "FROM chat_sessions s "
                    "WHERE s.edital_id = :eid "
                    "ORDER BY s.updated_at DESC LIMIT 20"
                ),
                {"eid": edital_id},
            ).fetchall()
        return [_serialize_row(dict(r._mapping)) for r in rows]

    return await asyncio.to_thread(_fetch)


