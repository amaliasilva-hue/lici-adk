"""Endpoints do Copiloto: chat (SSE), histórico, checklist."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from xerticaproc.backend.copilot_backend import get_backend
from xerticaproc.backend.models.copilot_schemas import (
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
async def chat(contratacao_id: str, payload: MensagemIn) -> StreamingResponse:
    """Envia mensagem do usuário. Retorna SSE com eventos do turno."""
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


# ─── Checklist ───────────────────────────────────────────────────────────────

@router.get("/checklist", response_model=ChecklistResponse)
async def get_checklist(contratacao_id: str) -> ChecklistResponse:
    backend = get_backend()
    return await backend.get_checklist(contratacao_id)


@router.patch("/checklist/{item_key}", response_model=ChecklistItem)
async def patch_checklist(
    contratacao_id: str, item_key: str, payload: ChecklistPatch,
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


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _format_sse(event: str, data: dict[str, Any]) -> bytes:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")
