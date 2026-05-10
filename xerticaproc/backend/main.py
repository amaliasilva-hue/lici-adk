"""FastAPI app — xerticaproc.

API de geração de ETP/TR para contratações públicas de TIC.

Endpoints:
  POST /proc/contratacoes                        → cria contratação
  POST /proc/contratacoes/{id}/etapa/{etapa}     → aciona etapa específica
  POST /proc/contratacoes/{id}/pipeline          → pipeline completo (async job)
  GET  /proc/contratacoes/{id}/status            → status e progresso
  GET  /proc/contratacoes/{id}/bundle            → EvidenceBundle completo
  GET  /proc/contratacoes/{id}/mapa-precos       → mapa de preços
  GET  /proc/contratacoes/{id}/etp               → texto do ETP gerado
  GET  /proc/contratacoes/{id}/tr                → texto do TR gerado
  GET  /proc/contratacoes                        → listar contratações
  GET  /proc/healthz                             → health check
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
import json
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException, Header
from pydantic import BaseModel

from xerticaproc.backend.agents.orchestrator import OrchestratorResult, executar_etapa, executar_pipeline_completo
from xerticaproc.backend.logging_config import configure_logging
from xerticaproc.backend.routes.copilot import router as copilot_router
from xerticaproc.backend.models.schemas import (
    ContratacaoCreated,
    EntradaDemanda,
    EtapaIniciada,
    EvidenceBundle,
    StatusContratacao,
    StatusEtapa,
    TipoDocumento,
    UnidadeMedida,
)

configure_logging()
log = logging.getLogger("xerticaproc.api")

app = FastAPI(
    title="xerticaproc",
    version="1.0.0",
    description="Plataforma de inteligência para ETP/TR — Contratações Públicas de TIC",
)

app.include_router(copilot_router)

# ── Estado em memória (MVP — substituir por AlloyDB em produção) ──────────────
_jobs: dict[str, dict[str, Any]] = {}
_contratacoes: dict[str, dict[str, Any]] = {}

ETAPAS_VALIDAS = {"demanda", "decomposicao", "mercado", "precos", "tecnico", "juridico", "riscos", "etp", "tr"}


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/proc/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "xerticaproc", "ts": datetime.now(timezone.utc).isoformat()}


# ─────────────────────────────────────────────────────────────────────────────
# Contratações
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/proc/contratacoes", response_model=ContratacaoCreated, status_code=201)
async def criar_contratacao(entrada: EntradaDemanda) -> ContratacaoCreated:
    """Cria uma nova contratação a partir dos dados básicos."""
    cid: uuid.UUID
    if os.environ.get("ALLOYDB_URL"):
        # Produção: persiste no Postgres para que o Copiloto enxergue a contratação.
        from xerticaproc.backend.tools.pg_tools import criar_contratacao as pg_criar_contratacao, get_session

        palavras_chave = [p for p in [entrada.objeto_da_contratacao, entrada.unidade_demandante] if p]
        dfd_texto = json.dumps(
            {
                "problema_publico": entrada.problema_publico,
                "objetivo": entrada.objetivo,
                "responsavel": entrada.responsavel,
            },
            ensure_ascii=False,
        )
        async with get_session() as s:
            cid_str = await pg_criar_contratacao(
                s,
                id_orgao=entrada.uasg or entrada.orgao,
                nome_orgao=entrada.orgao,
                objeto_resumido=entrada.objeto_da_contratacao,
                descricao_necessidade=entrada.problema_publico,
                uasg=entrada.uasg,
                natureza_objeto=None,
                valor_estimado_maximo=entrada.orcamento_estimado,
                prazo_vigencia_meses=entrada.prazo_estimado_meses,
                palavras_chave=palavras_chave,
                dfd_texto=dfd_texto,
            )
        cid = uuid.UUID(cid_str)
    else:
        cid = uuid.uuid4()

    _contratacoes[str(cid)] = {
        "id": str(cid),
        "entrada": entrada.model_dump(),
        "status": StatusContratacao.RASCUNHO.value,
        "criado_em": datetime.now(timezone.utc).isoformat(),
        "bundle": None,
        "etp": None,
        "tr": None,
    }
    log.info("api.contratacao_criada", extra={"id": str(cid), "orgao": entrada.orgao})
    return ContratacaoCreated(
        contratacao_id=cid,
        status=StatusContratacao.RASCUNHO,
        mensagem=f"Contratação {cid} criada. Execute a etapa 'demanda' para iniciar.",
    )


@app.get("/proc/contratacoes")
async def listar_contratacoes() -> list[dict[str, Any]]:
    """Lista todas as contratações."""
    return [
        {k: v for k, v in c.items() if k != "bundle"}  # bundle pode ser grande
        for c in _contratacoes.values()
    ]


@app.get("/proc/contratacoes/{contratacao_id}")
async def obter_contratacao(contratacao_id: str) -> dict[str, Any]:
    """Retorna detalhes de uma contratação."""
    c = _get_contratacao_or_404(contratacao_id)
    return {k: v for k, v in c.items() if k != "bundle"}


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline completo (background job)
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/proc/contratacoes/{contratacao_id}/pipeline", response_model=EtapaIniciada)
async def executar_pipeline(
    contratacao_id: str,
    background_tasks: BackgroundTasks,
    unidade_medida: UnidadeMedida = UnidadeMedida.USUARIO,
    quantidade_referencia: float = 1.0,
) -> EtapaIniciada:
    """Aciona o pipeline completo de geração de ETP/TR em background."""
    c = _get_contratacao_or_404(contratacao_id)
    entrada = EntradaDemanda.model_validate(c["entrada"])

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "contratacao_id": contratacao_id,
        "status": "queued",
        "agente_atual": None,
        "resultado": None,
        "erro": None,
        "progresso_pct": 0,
        "criado_em": datetime.now(timezone.utc).isoformat(),
    }

    background_tasks.add_task(
        _run_pipeline_background,
        job_id=job_id,
        contratacao_id=contratacao_id,
        entrada=entrada,
        unidade_medida=unidade_medida,
        quantidade_referencia=quantidade_referencia,
    )

    return EtapaIniciada(
        contratacao_id=uuid.UUID(contratacao_id),
        etapa="pipeline_completo",
        job_id=job_id,
        status="queued",
    )


async def _run_pipeline_background(
    job_id: str,
    contratacao_id: str,
    entrada: EntradaDemanda,
    unidade_medida: UnidadeMedida,
    quantidade_referencia: float,
) -> None:
    """Executa o pipeline em background thread."""
    _jobs[job_id]["status"] = "running"
    _jobs[job_id]["agente_atual"] = "agente_demanda"

    try:
        result: OrchestratorResult = await asyncio.to_thread(
            executar_pipeline_completo,
            entrada,
            None,  # documentos_pdf
            unidade_medida,
            quantidade_referencia,
            uuid.UUID(contratacao_id),
        )

        _contratacoes[contratacao_id]["bundle"] = result.bundle.model_dump()
        if result.etp:
            _contratacoes[contratacao_id]["etp"] = result.etp.model_dump()
        if result.tr:
            _contratacoes[contratacao_id]["tr"] = result.tr.model_dump()
        _contratacoes[contratacao_id]["status"] = StatusContratacao.REVISAO.value

        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["progresso_pct"] = 100
        _jobs[job_id]["resultado"] = {
            "latencia_ms": result.latencia_ms,
            "erros": result.erros,
            "etp_gerado": result.etp is not None,
            "tr_gerado": result.tr is not None,
        }

    except Exception as exc:
        log.exception("api.pipeline_error", extra={"job_id": job_id, "error": str(exc)})
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["erro"] = str(exc)


# ─────────────────────────────────────────────────────────────────────────────
# Etapa individual
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/proc/contratacoes/{contratacao_id}/etapa/{etapa}", response_model=EtapaIniciada)
async def executar_etapa_individual(
    contratacao_id: str,
    etapa: str,
    background_tasks: BackgroundTasks,
    unidade_medida: UnidadeMedida = UnidadeMedida.USUARIO,
    quantidade_referencia: float = 1.0,
) -> EtapaIniciada:
    """Aciona uma etapa específica do pipeline."""
    if etapa not in ETAPAS_VALIDAS:
        raise HTTPException(400, f"Etapa inválida: {etapa}. Válidas: {sorted(ETAPAS_VALIDAS)}")

    c = _get_contratacao_or_404(contratacao_id)
    entrada = EntradaDemanda.model_validate(c["entrada"])

    # Recuperar bundle existente ou criar novo
    bundle_data = c.get("bundle")
    bundle = (
        EvidenceBundle.model_validate(bundle_data)
        if bundle_data
        else EvidenceBundle(contratacao_id=uuid.UUID(contratacao_id), etapa="inicio")
    )

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "contratacao_id": contratacao_id,
        "etapa": etapa,
        "status": "queued",
        "agente_atual": f"agente_{etapa}",
        "resultado": None,
        "erro": None,
        "progresso_pct": 0,
    }

    background_tasks.add_task(
        _run_etapa_background,
        job_id=job_id,
        contratacao_id=contratacao_id,
        etapa=etapa,
        bundle=bundle,
        entrada=entrada,
        unidade_medida=unidade_medida,
        quantidade_referencia=quantidade_referencia,
    )

    return EtapaIniciada(
        contratacao_id=uuid.UUID(contratacao_id),
        etapa=etapa,
        job_id=job_id,
        status="queued",
    )


async def _run_etapa_background(
    job_id: str,
    contratacao_id: str,
    etapa: str,
    bundle: EvidenceBundle,
    entrada: EntradaDemanda,
    unidade_medida: UnidadeMedida,
    quantidade_referencia: float,
) -> None:
    _jobs[job_id]["status"] = "running"
    try:
        updated_bundle = await asyncio.to_thread(
            executar_etapa,
            etapa,
            bundle,
            entrada,
            unidade_medida_principal=unidade_medida,
            quantidade_referencia=quantidade_referencia,
        )
        _contratacoes[contratacao_id]["bundle"] = updated_bundle.model_dump()
        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["progresso_pct"] = 100
    except Exception as exc:
        log.exception("api.etapa_error", extra={"job_id": job_id, "etapa": etapa})
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["erro"] = str(exc)


# ─────────────────────────────────────────────────────────────────────────────
# Consultas de resultado
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/proc/contratacoes/{contratacao_id}/status", response_model=StatusEtapa)
async def status_contratacao(contratacao_id: str) -> StatusEtapa:
    c = _get_contratacao_or_404(contratacao_id)
    bundle_data = c.get("bundle")
    etapa_atual = bundle_data.get("etapa", "rascunho") if bundle_data else "rascunho"
    return StatusEtapa(
        contratacao_id=uuid.UUID(contratacao_id),
        etapa=etapa_atual,
        status=c["status"],
        progresso_pct=_calcular_progresso(etapa_atual),
    )


@app.get("/proc/jobs/{job_id}", response_model=StatusEtapa)
async def status_job(job_id: str) -> StatusEtapa:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id} não encontrado")
    return StatusEtapa(
        contratacao_id=uuid.UUID(job["contratacao_id"]),
        etapa=job.get("etapa", "pipeline"),
        status=job["status"],
        agente_atual=job.get("agente_atual"),
        resultado=job.get("resultado"),
        erro=job.get("erro"),
        progresso_pct=job.get("progresso_pct", 0),
    )


@app.get("/proc/contratacoes/{contratacao_id}/mapa-precos")
async def mapa_precos(contratacao_id: str) -> dict[str, Any]:
    c = _get_contratacao_or_404(contratacao_id)
    bundle = c.get("bundle")
    if not bundle or not bundle.get("mapa_precos"):
        raise HTTPException(404, "Mapa de preços ainda não gerado. Execute a etapa 'precos'.")
    return bundle["mapa_precos"]


@app.get("/proc/contratacoes/{contratacao_id}/etp")
async def obter_etp(contratacao_id: str) -> dict[str, Any]:
    c = _get_contratacao_or_404(contratacao_id)
    etp = c.get("etp")
    if not etp:
        raise HTTPException(404, "ETP ainda não gerado. Execute o pipeline completo.")
    return etp


@app.get("/proc/contratacoes/{contratacao_id}/tr")
async def obter_tr(contratacao_id: str) -> dict[str, Any]:
    c = _get_contratacao_or_404(contratacao_id)
    tr = c.get("tr")
    if not tr:
        raise HTTPException(404, "TR ainda não gerado. Execute o pipeline completo.")
    return tr


@app.get("/proc/contratacoes/{contratacao_id}/bundle")
async def obter_bundle(contratacao_id: str) -> dict[str, Any]:
    c = _get_contratacao_or_404(contratacao_id)
    bundle = c.get("bundle")
    if not bundle:
        raise HTTPException(404, "Bundle ainda não gerado.")
    return bundle


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_contratacao_or_404(contratacao_id: str) -> dict[str, Any]:
    c = _contratacoes.get(contratacao_id)
    if not c:
        raise HTTPException(404, f"Contratação {contratacao_id} não encontrada")
    return c


_PROGRESSO_POR_ETAPA = {
    "inicio": 0,
    "rascunho": 0,
    "demanda": 10,
    "decomposicao": 20,
    "mercado": 35,
    "precos": 50,
    "tecnico": 60,
    "juridico": 70,
    "riscos": 80,
    "etp": 88,
    "tr": 95,
    "revisao": 98,
    "concluido": 100,
}


def _calcular_progresso(etapa: str) -> int:
    return _PROGRESSO_POR_ETAPA.get(etapa, 0)
