"""Endpoints do Copiloto: chat (SSE), histórico, checklist, uploads."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from xerticaproc.backend.copilot_backend import get_backend
from xerticaproc.backend.middleware.rate_limit import enforce_chat_rate
from xerticaproc.backend.models.copilot_schemas import (
    Anexo,
    Aprovacao,
    AprovacaoIn,
    ChatHistoryResponse,
    ChecklistItem,
    ChecklistPatch,
    ChecklistResponse,
    DocumentReadiness,
    DocumentoGeradoLite,
    EventoOut,
    FonteUsuario,
    FonteUsuarioIn,
    FonteUsuarioPatch,
    MensagemIn,
    PesquisaNegativa,
    PesquisaNegativaIn,
)

log = logging.getLogger("xerticaproc.api.copilot")

router = APIRouter(prefix="/proc/contratacoes/{contratacao_id}", tags=["copilot"])


# ─── Chat ────────────────────────────────────────────────────────────────────

@router.post("/chat")
async def chat(contratacao_id: str, payload: MensagemIn, request: Request) -> StreamingResponse:
    """Envia mensagem do usuário. Retorna SSE com eventos do turno."""
    enforce_chat_rate(request, contratacao_id)
    backend = get_backend()
    await backend.ensure_seed(contratacao_id)

    async def _sse() -> AsyncIterator[bytes]:
        try:
            async for event_name, data in backend.stream_turn(
                contratacao_id=contratacao_id,
                user_message=payload.message,
                anexos=payload.anexos,
            ):
                yield _format_sse(event_name, data)
        except Exception as exc:  # noqa: BLE001
            log.exception("chat_error", extra={"contratacao_id": contratacao_id})
            yield _format_sse("error", {"code": "INTERNAL", "message": str(exc)})

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/chat/history", response_model=ChatHistoryResponse)
async def chat_history(
    contratacao_id: str,
    limit: int = Query(50, ge=1, le=200),
    before: Optional[datetime] = Query(None),
) -> ChatHistoryResponse:
    backend = get_backend()
    msgs = await backend.list_history(contratacao_id, limit=limit, before=before)
    return ChatHistoryResponse(messages=msgs, has_more=len(msgs) >= limit)


# ─── Uploads (multimodal: PDF / imagem / DOCX / XLSX) ────────────────────────

_MAX_UPLOAD_BYTES = int(os.environ.get("COPILOT_MAX_UPLOAD_BYTES", str(40 * 1024 * 1024)))
_ALLOWED_PREFIXES = (
    "application/pdf",
    "image/",
    "text/",
    "application/vnd.openxmlformats-officedocument",
    "application/msword",
    "application/vnd.ms-excel",
    "application/octet-stream",
)


def _classify_anexo_tipo(mime: str) -> str:
    if mime.startswith("image/"):
        return "imagem"
    if mime.startswith("text/"):
        return "texto"
    return "arquivo"


def _upload_to_gcs(bucket_name: str, key: str, data: bytes, mime: str) -> str:
    from google.cloud import storage  # type: ignore
    cli = storage.Client()
    bucket = cli.bucket(bucket_name)
    blob = bucket.blob(key)
    blob.upload_from_string(data, content_type=mime)
    return f"gs://{bucket_name}/{key}"


@router.post("/uploads", response_model=Anexo, status_code=201)
async def upload_anexo(
    contratacao_id: str,
    file: UploadFile = File(...),
    nome: Optional[str] = Form(None),
) -> Anexo:
    """Recebe upload binário e retorna `Anexo` (gcs_uri ou inline url).

    Bucket configurável via env `COPILOT_UPLOADS_BUCKET`. Sem bucket, o arquivo
    fica em memória (modo dev) — nesse caso `Anexo.url` é `data:` base64.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "arquivo vazio")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            f"arquivo excede limite ({len(raw)} > {_MAX_UPLOAD_BYTES} bytes)",
        )
    mime = file.content_type or "application/octet-stream"
    if not any(mime.startswith(p) for p in _ALLOWED_PREFIXES):
        raise HTTPException(415, f"mime não suportado: {mime}")

    safe_name = (nome or file.filename or "anexo").strip().replace("/", "_")[:200]
    bucket = os.environ.get("COPILOT_UPLOADS_BUCKET")
    if bucket:
        import asyncio as _asyncio
        key = f"copilot/{contratacao_id}/{uuid.uuid4()}-{safe_name}"
        gcs_uri = await _asyncio.to_thread(_upload_to_gcs, bucket, key, raw, mime)
        return Anexo(
            tipo=_classify_anexo_tipo(mime),
            nome=safe_name,
            gcs_uri=gcs_uri,
        )

    # Fallback dev: data URL base64 — o backend de processamento aceita?
    # O extractor lê via httpx GET, então data: URL não funciona. Em dev sem
    # bucket, retornamos texto se for texto, senão erro.
    if mime.startswith("text/"):
        return Anexo(
            tipo="texto",
            nome=safe_name,
            url=raw.decode("utf-8", errors="replace"),
        )
    raise HTTPException(
        503,
        "COPILOT_UPLOADS_BUCKET não configurado; uploads binários indisponíveis",
    )


# ─── Checklist ───────────────────────────────────────────────────────────────

@router.get("/checklist", response_model=ChecklistResponse)
async def get_checklist(contratacao_id: str) -> ChecklistResponse:
    backend = get_backend()
    return await backend.get_checklist(contratacao_id)


@router.patch("/checklist/{item_key}", response_model=ChecklistItem)
async def patch_checklist(
    contratacao_id: str, item_key: str, payload: ChecklistPatch,
    request: Request,
) -> ChecklistItem:
    backend = get_backend()
    try:
        item = await backend.patch_checklist_item(
            contratacao_id, item_key,
            status=payload.status, valor=payload.valor,
            justificativa=payload.justificativa,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    if item is None:
        raise HTTPException(404, f"Item de checklist {item_key} não encontrado")
    user = request.headers.get("x-user-id", "anon")
    log.info(
        "checklist.patch",
        extra={
            "event": "checklist.patch", "contratacao_id": contratacao_id,
            "item_key": item_key, "status": payload.status.value,
            "user": user,
        },
    )
    return item




# ─── Sprint B: Fontes (Price Workbench) ──────────────────────────────────────

@router.get("/fontes", response_model=list[FonteUsuario])
async def list_fontes(contratacao_id: str) -> list[FonteUsuario]:
    backend = get_backend()
    return await backend.list_sources(contratacao_id)


@router.post("/fontes", response_model=FonteUsuario, status_code=202)
async def add_fonte(
    contratacao_id: str, payload: FonteUsuarioIn,
) -> FonteUsuario:
    backend = get_backend()
    return await backend.add_source(contratacao_id, payload)


@router.patch("/fontes/{source_id}", response_model=FonteUsuario)
async def patch_fonte(
    contratacao_id: str, source_id: str, payload: FonteUsuarioPatch,
) -> FonteUsuario:
    backend = get_backend()
    src = await backend.patch_source(contratacao_id, source_id, payload)
    if src is None:
        raise HTTPException(404, f"Fonte {source_id} não encontrada")
    return src


@router.get("/pesquisas-negativas", response_model=list[PesquisaNegativa])
async def list_negativas(contratacao_id: str) -> list[PesquisaNegativa]:
    backend = get_backend()
    return await backend.list_negative_searches(contratacao_id)


@router.post(
    "/pesquisas-negativas", response_model=PesquisaNegativa, status_code=201,
)
async def add_negativa(
    contratacao_id: str, payload: PesquisaNegativaIn,
) -> PesquisaNegativa:
    backend = get_backend()
    return await backend.add_negative_search(contratacao_id, payload)


# ─── Sprint C: Readiness + geração de documentos ────────────────────────────

@router.get("/readiness", response_model=DocumentReadiness)
async def get_readiness(
    contratacao_id: str,
    doc_type: str = Query("etp", pattern="^(etp|tr|mapa_precos)$"),
) -> DocumentReadiness:
    backend = get_backend()
    return await backend.evaluate_readiness(contratacao_id, doc_type)


@router.post("/gerar/{doc_type}", response_model=DocumentoGeradoLite)
async def gerar_documento(
    contratacao_id: str, doc_type: str,
) -> DocumentoGeradoLite:
    if doc_type not in ("etp", "tr", "mapa_precos"):
        raise HTTPException(400, "doc_type inválido")
    backend = get_backend()
    return await backend.generate_document(contratacao_id, doc_type)


@router.get("/documentos", response_model=list[DocumentoGeradoLite])
async def list_documentos(contratacao_id: str) -> list[DocumentoGeradoLite]:
    backend = get_backend()
    return await backend.list_documents(contratacao_id)


# ─── Sprint D: Revisor + Pacote de evidências ───────────────────────────────

@router.get("/revisar")
async def revisar(contratacao_id: str) -> dict[str, Any]:
    backend = get_backend()
    report = await backend.review_documents(contratacao_id)
    # report é um RevisorReport (Pydantic)
    return report.model_dump(mode="json")


@router.get("/pacote-evidencias")
async def pacote_evidencias(contratacao_id: str) -> StreamingResponse:
    from io import BytesIO
    backend = get_backend()
    blob = await backend.build_evidence_pack(contratacao_id)
    return StreamingResponse(
        BytesIO(blob),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="evidencias-{contratacao_id}.zip"'
            ),
        },
    )


# ─── Sprint D extra: Aprovações + Eventos ──────────────────────────────────

@router.post(
    "/documentos/{documento_id}/aprovacoes",
    response_model=Aprovacao, status_code=201,
)
async def add_aprovacao(
    contratacao_id: str, documento_id: str, payload: AprovacaoIn,
) -> Aprovacao:
    backend = get_backend()
    if not hasattr(backend, "add_aprovacao"):
        raise HTTPException(501, "Aprovações não suportadas neste backend")
    return await backend.add_aprovacao(contratacao_id, documento_id, payload)  # type: ignore[attr-defined]


@router.get("/aprovacoes", response_model=list[Aprovacao])
async def list_aprovacoes(contratacao_id: str) -> list[Aprovacao]:
    backend = get_backend()
    if not hasattr(backend, "list_aprovacoes"):
        return []
    return await backend.list_aprovacoes(contratacao_id)  # type: ignore[attr-defined]


@router.get("/documentos/{documento_id}/workflow")
async def documento_workflow(
    contratacao_id: str, documento_id: str,
) -> dict[str, Any]:
    """Retorna status agregado do workflow de aprovação do documento."""
    from xerticaproc.backend.agents.approval_workflow import evaluate_workflow
    backend = get_backend()
    docs = await backend.list_documents(contratacao_id)
    doc = next((d for d in docs if str(d.id) == documento_id), None)
    if doc is None:
        raise HTTPException(404, "Documento não encontrado")
    aprovs_all = (
        await backend.list_aprovacoes(contratacao_id)  # type: ignore[attr-defined]
        if hasattr(backend, "list_aprovacoes") else []
    )
    aprovs = [a for a in aprovs_all if str(a.documento_id) == documento_id]
    return evaluate_workflow(doc.doc_type, aprovs)


@router.get("/eventos", response_model=list[EventoOut])
async def list_eventos(
    contratacao_id: str,
    only_unread: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
) -> list[EventoOut]:
    backend = get_backend()
    if not hasattr(backend, "list_eventos"):
        return []
    return await backend.list_eventos(  # type: ignore[attr-defined]
        contratacao_id, only_unread=only_unread, limit=limit,
    )


@router.post("/eventos/marcar-lidos")
async def mark_eventos_read(contratacao_id: str) -> dict[str, int]:
    backend = get_backend()
    if not hasattr(backend, "mark_eventos_read"):
        return {"updated": 0}
    n = await backend.mark_eventos_read(contratacao_id)  # type: ignore[attr-defined]
    return {"updated": n}


@router.post("/documentos/{documento_id}/renderizar")
async def renderizar_documento(
    contratacao_id: str, documento_id: str,
    formats: str = Query("docx,pdf"),
) -> dict[str, Any]:
    """Dispara Cloud Run Job pandoc para gerar DOCX/PDF do documento."""
    from xerticaproc.backend.tools.pandoc_renderer import render_to_gcs
    backend = get_backend()
    docs = await backend.list_documents(contratacao_id)
    doc = next((d for d in docs if str(d.id) == documento_id), None)
    if doc is None:
        raise HTTPException(404, "Documento não encontrado")
    fmts = [f.strip() for f in formats.split(",") if f.strip()]
    return await render_to_gcs(
        contratacao_id=contratacao_id, doc_type=doc.doc_type,
        versao=doc.versao, content_md=doc.content_md, formats=fmts,
    )


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _format_sse(event: str, data: dict[str, Any]) -> bytes:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")
