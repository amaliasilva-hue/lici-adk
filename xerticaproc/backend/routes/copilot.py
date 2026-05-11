"""Endpoints do Copiloto: chat (SSE), histórico, checklist, uploads."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any, AsyncIterator, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import Response, StreamingResponse

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
    Documento,
    DocumentoListResponse,
    DocumentoOrigem,
    DocumentoPatch,
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
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    nome: Optional[str] = Form(None),
) -> Anexo:
    """Compatibilidade — recebe upload e devolve `Anexo` para o chat,
    porém agora também grava na biblioteca de Documentos (com dedup) e
    agenda o pipeline de processamento (extract+thumb).
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
    if not bucket:
        # fallback dev: somente texto
        if mime.startswith("text/"):
            return Anexo(tipo="texto", nome=safe_name,
                         url=raw.decode("utf-8", errors="replace"))
        raise HTTPException(
            503,
            "COPILOT_UPLOADS_BUCKET não configurado; uploads binários indisponíveis",
        )

    # Ingest na biblioteca (com dedup por SHA256) + agenda pipeline
    from xerticaproc.backend.tools import documentos_pipeline as dp
    user = (request.headers.get("x-user-email")
            or request.headers.get("x-user")
            or "anonimo")
    try:
        doc_id, was_new = await dp.ingest_upload(
            contratacao_id=contratacao_id,
            raw=raw,
            nome=safe_name,
            mime=mime,
            uploaded_by=user,
        )
    except Exception:  # noqa: BLE001
        log.exception("ingest_upload falhou")
        raise HTTPException(500, "falha ao ingerir documento")

    if was_new:
        background_tasks.add_task(dp.process_documento, doc_id, contratacao_id)

    # devolve Anexo (formato esperado pelo chat) com gcs_uri persistido
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        doc = await ds.get_by_id(
            s, contratacao_id=contratacao_id, documento_id=doc_id,
        )
    if doc is None:
        raise HTTPException(500, "documento criado mas não encontrado")
    return Anexo(
        tipo=_classify_anexo_tipo(doc.mime),
        nome=doc.nome,
        gcs_uri=doc.storage_uri,
    )


# ─── Biblioteca de Documentos ────────────────────────────────────────────────

@router.get("/biblioteca", response_model=DocumentoListResponse)
async def list_biblioteca(
    contratacao_id: str,
    origem: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> DocumentoListResponse:
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        items, total = await ds.list_documentos(
            s,
            contratacao_id=contratacao_id,
            origem=origem,
            status=status,
            q=q,
            limit=limit,
            offset=offset,
        )
    return DocumentoListResponse(items=items, total=total)


@router.get("/biblioteca/{documento_id}", response_model=Documento)
async def get_biblioteca_doc(contratacao_id: str, documento_id: str) -> Documento:
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        doc = await ds.get_by_id(
            s, contratacao_id=contratacao_id, documento_id=documento_id,
        )
    if doc is None:
        raise HTTPException(404, "documento não encontrado")
    return doc


@router.get("/biblioteca/{documento_id}/conteudo")
async def get_biblioteca_conteudo(contratacao_id: str, documento_id: str):
    """Stream binário do documento original. Auth via proxy/middleware."""
    from xerticaproc.backend.tools import documentos_pipeline as dp
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        doc = await ds.get_by_id(
            s, contratacao_id=contratacao_id, documento_id=documento_id,
        )
    if doc is None:
        raise HTTPException(404, "documento não encontrado")
    try:
        data = await dp.gcs_download(doc.storage_uri)
    except Exception:  # noqa: BLE001
        log.exception("download conteudo falhou")
        raise HTTPException(502, "falha lendo do storage")
    headers = {
        "Content-Disposition": f'inline; filename="{doc.nome}"',
        "Cache-Control": "private, max-age=300",
    }
    return Response(content=data, media_type=doc.mime, headers=headers)


@router.get("/biblioteca/{documento_id}/thumb")
async def get_biblioteca_thumb(contratacao_id: str, documento_id: str):
    from xerticaproc.backend.tools import documentos_pipeline as dp
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        doc = await ds.get_by_id(
            s, contratacao_id=contratacao_id, documento_id=documento_id,
        )
    if doc is None or not doc.thumb_uri:
        raise HTTPException(404, "thumb indisponível")
    try:
        data = await dp.gcs_download(doc.thumb_uri)
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "falha lendo thumb")
    return Response(
        content=data, media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.patch("/biblioteca/{documento_id}", response_model=Documento)
async def patch_biblioteca_doc(
    contratacao_id: str,
    documento_id: str,
    payload: DocumentoPatch,
) -> Documento:
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        doc = await ds.patch_documento(
            s,
            contratacao_id=contratacao_id,
            documento_id=documento_id,
            nome=payload.nome,
            meta_patch=payload.meta,
        )
    if doc is None:
        raise HTTPException(404, "documento não encontrado")
    return doc


@router.delete("/biblioteca/{documento_id}", status_code=204)
async def delete_biblioteca_doc(contratacao_id: str, documento_id: str):
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        ok = await ds.soft_delete(
            s, contratacao_id=contratacao_id, documento_id=documento_id,
        )
    if not ok:
        raise HTTPException(404, "documento não encontrado")


@router.post("/biblioteca/{documento_id}/reindex", response_model=Documento)
async def reindex_biblioteca_doc(
    contratacao_id: str,
    documento_id: str,
    background_tasks: BackgroundTasks,
) -> Documento:
    from xerticaproc.backend.tools import documentos_pipeline as dp
    from xerticaproc.backend.tools import documentos_store as ds
    from xerticaproc.backend.models.copilot_schemas import DocumentoStatus
    from xerticaproc.backend.tools.pg_tools import get_session
    async with get_session() as s:
        doc = await ds.get_by_id(
            s, contratacao_id=contratacao_id, documento_id=documento_id,
        )
        if doc is None:
            raise HTTPException(404, "documento não encontrado")
        await ds.update_processed(
            s, documento_id=documento_id, status=DocumentoStatus.PROCESSANDO,
        )
        doc = await ds.get_by_id(
            s, contratacao_id=contratacao_id, documento_id=documento_id,
        )
    background_tasks.add_task(dp.process_documento, documento_id, contratacao_id)
    return doc


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


_DOC_TYPE_TITLES = {
    "etp": "Estudo Técnico Preliminar",
    "tr": "Termo de Referência",
    "mapa_precos": "Mapa de Preços",
}


@router.get("/documentos/{documento_id}/download")
async def download_documento(
    contratacao_id: str, documento_id: str,
    format: str = Query("docx", pattern="^(docx|md)$"),
) -> Response:
    """Baixa o documento gerado em DOCX (default) ou Markdown.

    Conversão Markdown → DOCX é feita inline com python-docx,
    sem dependência do Cloud Run Job pandoc.
    """
    backend = get_backend()
    docs = await backend.list_documents(contratacao_id)
    doc = next((d for d in docs if str(d.id) == documento_id), None)
    if doc is None:
        raise HTTPException(404, "Documento não encontrado")

    base_name = f"{doc.doc_type}-v{doc.versao}-{contratacao_id}"

    if format == "md":
        return Response(
            content=doc.content_md.encode("utf-8"),
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}.md"',
            },
        )

    from xerticaproc.backend.tools.markdown_docx import markdown_to_docx_bytes
    title = f"{_DOC_TYPE_TITLES.get(doc.doc_type, doc.doc_type.upper())} — v{doc.versao}"
    blob = markdown_to_docx_bytes(doc.content_md, title=title)
    return Response(
        content=blob,
        media_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        headers={
            "Content-Disposition": f'attachment; filename="{base_name}.docx"',
        },
    )


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _format_sse(event: str, data: dict[str, Any]) -> bytes:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")
