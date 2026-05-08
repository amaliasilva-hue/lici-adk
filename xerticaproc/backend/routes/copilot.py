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
    ChatHistoryResponse,
    ChecklistItem,
    ChecklistPatch,
    ChecklistResponse,
    MensagemIn,
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


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _format_sse(event: str, data: dict[str, Any]) -> bytes:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")
