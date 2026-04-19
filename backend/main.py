"""FastAPI app — endpoint /analyze assíncrono.

Contrato (ARCHITECTURE.md §Contrato da API):
  POST /analyze         → multipart com PDF, retorna {analysis_id, status: queued}
  GET  /analyze/{id}    → polling, retorna {status, current_agent, result?, error?}
  GET  /healthz         → health check

MVP: in-memory job store. Para múltiplas instâncias do Cloud Run em produção,
trocar por Firestore (Fase 2). Mantemos `min-instances=1, max-instances=1` por
enquanto para garantir consistência do dict.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.agents.orchestrator_adk import analisar_edital
from backend.agents.persistor import DEST_DATASET, DEST_PROJECT, DEST_TABLE
from backend.logging_config import configure_logging
from backend.models.schemas import ParecerComercial
from backend.tools.pg_tools import ensure_schema, invalidate_cache, invalidate_all_cache
from google.cloud import bigquery

configure_logging()
log = logging.getLogger("lici_adk.api")

app = FastAPI(title="lici-adk", version="0.1.0")


@app.on_event("startup")
async def _startup() -> None:
    """Cria tabelas Postgres na inicialização (idempotente)."""
    try:
        await asyncio.to_thread(ensure_schema)
        log.info("startup.pg_schema_ok")
    except Exception as exc:
        # Falha silenciosa: Cloud SQL pode não estar disponível em env dev
        log.warning("startup.pg_schema_failed", extra={"error": str(exc)})

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


# In-memory store (MVP — single instance).
_JOBS: dict[str, JobState] = {}


def _touch(job: JobState, **kwargs) -> None:
    for k, v in kwargs.items():
        setattr(job, k, v)
    job.updated_at = datetime.now(timezone.utc)


def _run_pipeline(analysis_id: str, pdf_bytes: bytes, filename: str | None = None) -> None:
    job = _JOBS[analysis_id]
    try:
        _touch(job, status="running", current_agent="extrator")
        parecer = analisar_edital(pdf_bytes, trace_id=analysis_id, edital_filename=filename)
        _touch(job, status="done", current_agent=None, result=parecer)
    except Exception as exc:  # noqa: BLE001
        log.exception("pipeline.failed", extra={"lici_adk": {"trace_id": analysis_id}})
        _touch(job, status="failed", current_agent=None, error=f"{type(exc).__name__}: {exc}")


@app.get("/health")
def healthz() -> dict:
    return {"status": "ok", "jobs_in_memory": len(_JOBS)}


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

    analysis_id = str(uuid.uuid4())
    _JOBS[analysis_id] = JobState(
        analysis_id=analysis_id,
        edital_filename=file.filename,
    )
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
def get_analysis(analysis_id: str) -> JobState:
    job = _JOBS.get(analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="analysis_id desconhecido")
    return job


@app.get("/analyze")
def list_analyses(limit: int = 20) -> list[dict]:
    """Lista jobs recentes (debug)."""
    items = sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:limit]
    return [
        {
            "analysis_id": j.analysis_id,
            "status": j.status,
            "current_agent": j.current_agent,
            "filename": j.edital_filename,
            "created_at": j.created_at.isoformat(),
        }
        for j in items
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
