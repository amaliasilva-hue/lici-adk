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
import json
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
from backend.models.schemas import BidConfig, EditalEstruturado, ParecerComercial, RelatorioLicitatorio
from backend.tools.pg_tools import (
    ensure_schema, invalidate_cache, invalidate_all_cache,
    create_edital, get_edital, list_editais, update_edital, soft_delete_edital,
    add_movimentacao, list_movimentacoes,
    add_comentario, list_comentarios,
    seed_gates, list_gates, set_gate,
    STAGES_ORDER, ESTADOS_TERMINAIS,
)
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
    # Fase 5 — dados extras do pipeline + análise jurídica
    edital_json: dict | None = None
    somatorio_drive_json: dict | None = None
    relatorio_juridico: RelatorioLicitatorio | None = None
    job_juridico_status: Literal["not_started", "running", "done", "failed"] = "not_started"
    error_juridico: str | None = None
    # Fase 6 — edital_id do Postgres criado após pipeline
    pg_edital_id: str | None = None


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
        pipeline_result = analisar_edital(pdf_bytes, trace_id=analysis_id, edital_filename=filename)
        _touch(
            job,
            status="done",
            current_agent=None,
            result=pipeline_result.parecer,
            edital_json=pipeline_result.edital.model_dump() if pipeline_result.edital else None,
            somatorio_drive_json=pipeline_result.somatorio_drive,
        )
        # Fase 6 — persiste registro no Cloud SQL (best-effort, não falha o job)
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
            # Persiste result completo para sobreviver a restarts
            if pipeline_result.parecer:
                data["result_json"] = json.dumps(pipeline_result.parecer.model_dump(), ensure_ascii=False, default=str)
            # Persiste edital_json para permitir reanálise jurídica após restart
            if pipeline_result.edital:
                data["edital_json_storage"] = json.dumps(pipeline_result.edital.model_dump(), ensure_ascii=False, default=str)
            row = create_edital(data)
            eid = str(row["edital_id"])
            # Guarda edital_id no job para que o polling possa redirecionar
            _touch(job, pg_edital_id=eid)
            seed_gates(eid, "identificacao")
            log.info("pipeline.edital_row_created", extra={"lici_adk": {"trace_id": analysis_id, "edital_id": eid}})
        except Exception as pg_exc:  # noqa: BLE001
            log.warning("pipeline.pg_persist_failed", extra={"error": str(pg_exc)})
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


# ──────────────────────── Fase 5 — Análise Jurídica ─────────────────────────


def _run_juridico(analysis_id: str, bid_config: BidConfig | None = None) -> None:
    """Background task: executa o Analista Licitatório a partir do edital_json já armazenado."""
    from backend.agents.analista_licitatorio import analisar_juridico

    job = _JOBS.get(analysis_id)
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
        _touch(job, relatorio_juridico=relatorio, job_juridico_status="done")
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
        _touch(job, job_juridico_status="failed", error_juridico=f"{type(exc).__name__}: {exc}")


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
    job = _JOBS.get(analysis_id)
    if not job:
        # Tenta reconstruir job a partir do Postgres (edital_id = analysis_id após container restart)
        try:
            from backend.tools.pg_tools import get_edital as _get_edital_pg
            pg_row = await asyncio.to_thread(_get_edital_pg, analysis_id)
        except Exception:
            pg_row = None
        if not pg_row:
            raise HTTPException(status_code=404, detail="analysis_id não encontrado")
        edital_json_stored = pg_row.get("edital_json_storage")
        result_json_stored = pg_row.get("result_json")
        if not edital_json_stored or not result_json_stored:
            raise HTTPException(
                status_code=409,
                detail="Dados insuficientes para reanálise — processe o edital novamente para armazenar edital_json",
            )
        edital_json_data = json.loads(edital_json_stored) if isinstance(edital_json_stored, str) else edital_json_stored
        result_data = json.loads(result_json_stored) if isinstance(result_json_stored, str) else result_json_stored
        _JOBS[analysis_id] = JobState(
            analysis_id=analysis_id,
            status="done",
            edital_json=edital_json_data,
            result=ParecerComercial.model_validate(result_data),
            pg_edital_id=str(pg_row["edital_id"]),
            edital_filename=pg_row.get("edital_filename"),
        )
        job = _JOBS[analysis_id]
    if job.status != "done":
        raise HTTPException(status_code=409, detail="análise comercial ainda não concluída — aguarde status=done")
    if not job.edital_json:
        raise HTTPException(status_code=409, detail="edital_json não disponível (pipeline mais antigo?)")
    if job.job_juridico_status == "running":
        return {"analysis_id": analysis_id, "status": "running", "message": "análise jurídica já em andamento"}

    _touch(job, job_juridico_status="running", error_juridico=None, relatorio_juridico=None)
    background_tasks.add_task(_run_juridico, analysis_id, bid_config)
    return {"analysis_id": analysis_id, "status": "running"}


@app.get("/editais/{analysis_id}/analise_juridica")
def get_analise_juridica(analysis_id: str) -> dict:
    """Polling da análise jurídica. Retorna RelatorioLicitatorio quando status=done."""
    job = _JOBS.get(analysis_id)
    if not job:
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
def get_kit_habilitacao(analysis_id: str) -> dict:
    """Retorna o Bloco 6 (KitHabilitacao) da análise jurídica quando disponível."""
    job = _JOBS.get(analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="analysis_id não encontrado")
    if job.job_juridico_status != "done" or not job.relatorio_juridico:
        raise HTTPException(status_code=404, detail="análise jurídica ainda não disponível")
    return job.relatorio_juridico.kit_habilitacao.model_dump()


@app.get("/editais/{analysis_id}/documentos")
def list_documentos(analysis_id: str) -> dict:
    """Lista todos os documentos gerados: minutas (Bloco 4) + declarações padrão (Grupo B)."""
    from backend.agents.gerador_documentos import gerar_declaracoes, listar_tipos_disponiveis

    job = _JOBS.get(analysis_id)
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

    # Declarações disponíveis (sempre geráveis quando edital_json existe)
    declaracoes_disponiveis = listar_tipos_disponiveis() if job.edital_json else []

    return {
        "analysis_id": analysis_id,
        "minutas_pre_sessao": minutas,
        "declaracoes_disponiveis": declaracoes_disponiveis,
    }


@app.get("/editais/{analysis_id}/documentos/{tipo}")
def get_documento(analysis_id: str, tipo: str) -> dict:
    """Retorna texto pronto para copiar de um documento específico.

    tipo: impugnacao | esclarecimento | declaracoes | kit
    Para declarações individuais: nao_emprega_menor | idoneidade | habilitacao |
                                   fato_superveniente | pleno_conhecimento |
                                   autenticidade | vinculo_tecnicos | credenciamento
    """
    from backend.agents.gerador_documentos import gerar_declaracoes, listar_tipos_disponiveis

    job = _JOBS.get(analysis_id)
    if not job:
        raise HTTPException(status_code=404, detail="analysis_id não encontrado")

    # Minutas pré-sessão (Bloco 4)
    if tipo in ("impugnacao", "esclarecimento") and job.relatorio_juridico:
        docs = [
            d for d in job.relatorio_juridico.documentos_protocolo
            if d.tipo == tipo.upper()
        ]
        if not docs:
            raise HTTPException(status_code=404, detail=f"nenhum documento do tipo {tipo} gerado")
        return {
            "tipo": tipo,
            "documentos": [d.model_dump() for d in docs],
        }

    # Kit de habilitação (Bloco 6)
    if tipo == "kit":
        if not job.relatorio_juridico:
            raise HTTPException(status_code=404, detail="análise jurídica não disponível")
        return {"tipo": "kit", "kit_habilitacao": job.relatorio_juridico.kit_habilitacao.model_dump()}

    # Declarações padrão (Grupo B)
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
    """Retorna edital + comentários + gates. Aceita tanto edital_id (UUID Postgres) quanto analysis_id (job em memória)."""
    # Primeiro tenta como edital no Postgres
    row = await asyncio.to_thread(get_edital, edital_id_or_analysis_id)
    if row:
        eid = str(row["edital_id"])
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
    # Fallback: job em memória (retrocompat — analysis_id efêmero)
    job = _JOBS.get(edital_id_or_analysis_id)
    if job:
        data = job.model_dump()
        # Inclui pg_edital_id no response para o frontend redirecionar
        return data
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


class _ComentarioRequest(BaseModel):
    texto: str
    autor_email: str = "sistema"
    mencionados: list[str] = []


@app.post("/editais/{edital_id}/comentarios", status_code=201)
async def post_comentario(edital_id: str, body: _ComentarioRequest) -> dict:
    current = await asyncio.to_thread(get_edital, edital_id)
    if not current:
        raise HTTPException(status_code=404, detail="edital não encontrado")
    row = await asyncio.to_thread(add_comentario, edital_id, body.autor_email, body.texto, body.mencionados)
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
