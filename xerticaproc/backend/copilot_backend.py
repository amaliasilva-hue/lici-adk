"""Copilot Backend — abstração entre Postgres (produção) e in-memory (dev).

A implementação in-memory permite rodar o chat copilot sem AlloyDB,
facilitando dev local e testes. A Postgres delega aos módulos
`tools.conversation_store` e `agents.checklist_engine`.

A escolha é feita em runtime via env `ALLOYDB_URL`.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional, Protocol
from uuid import UUID

from xerticaproc.backend.agents import checklist_engine as ce
from xerticaproc.backend.models.copilot_schemas import (
    Anexo,
    ChecklistCriticidade,
    ChecklistItem,
    ChecklistOwner,
    ChecklistResponse,
    ChecklistStatus,
    ChecklistSummary,
    ConversationTurnAnalysis,
    MensagemOut,
    MensagemRole,
)

log = logging.getLogger(__name__)


class CopilotBackend(Protocol):
    async def ensure_seed(self, contratacao_id: str) -> None: ...
    async def handle_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> dict[str, Any]: ...
    async def stream_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]: ...
    async def list_history(
        self, contratacao_id: str, limit: int = 50,
        before: Optional[datetime] = None,
    ) -> list[MensagemOut]: ...
    async def get_checklist(self, contratacao_id: str) -> ChecklistResponse: ...
    async def patch_checklist_item(
        self,
        contratacao_id: str,
        item_key: str,
        *,
        status: ChecklistStatus,
        valor: Optional[Any] = None,
        justificativa: Optional[str] = None,
    ) -> Optional[ChecklistItem]: ...


# ─────────────────────────────────────────────────────────────────────────────
# In-memory backend (dev / testes)
# ─────────────────────────────────────────────────────────────────────────────

class InMemoryCopilotBackend:
    def __init__(self) -> None:
        # contratacao_id -> { conversa_id, mensagens[], facts[], decisions[],
        #                     checklist{item_key: ChecklistItem} }
        self._data: dict[str, dict[str, Any]] = {}

    def _state(self, cid: str) -> dict[str, Any]:
        st = self._data.get(cid)
        if st is None:
            st = {
                "conversa_id": str(uuid.uuid4()),
                "resumo": None,
                "mensagens": [],
                "facts": [],
                "decisions": [],
                "checklist": {},
            }
            self._data[cid] = st
        return st

    async def ensure_seed(self, contratacao_id: str) -> None:
        st = self._state(contratacao_id)
        if st["checklist"]:
            return
        for it in ce.CHECKLIST_SEED:
            st["checklist"][it["item_key"]] = ChecklistItem(
                item_key=it["item_key"],
                categoria=it["categoria"],
                label=it["label"],
                status=ChecklistStatus.PENDENTE,
                criticidade=ChecklistCriticidade(it["criticidade"]),
                owner=ChecklistOwner(it["owner"]),
                atualizado_em=datetime.now(timezone.utc),
            )

    async def handle_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> dict[str, Any]:
        from xerticaproc.backend.agents.conversation_orchestrator import (
            _analyze, _build_prompt,
        )

        await self.ensure_seed(contratacao_id)
        st = self._state(contratacao_id)

        # 1) registra mensagem do usuário
        user_msg_id = str(uuid.uuid4())
        st["mensagens"].append(MensagemOut(
            id=UUID(user_msg_id),
            role=MensagemRole.USER,
            conteudo=user_message,
            anexos=anexos or [],
            criado_em=datetime.now(timezone.utc),
        ))

        # 2) contexto
        checklist = await self.get_checklist(contratacao_id)
        recent = [
            {"role": m.role.value, "content": m.conteudo}
            for m in st["mensagens"][-8:]
        ]
        prompt = _build_prompt(
            user_message=user_message,
            facts=st["facts"],
            decisions=st["decisions"],
            checklist_summary=checklist.summary.model_dump(),
            recent=recent,
            resumo=st["resumo"],
        )

        # 3) LLM
        analysis = await _analyze(
            prompt,
            {"checklist_summary": checklist.summary.model_dump()},
            user_message,
        )

        # 4) persiste mensagem assistente
        assistant_msg_id = str(uuid.uuid4())
        st["mensagens"].append(MensagemOut(
            id=UUID(assistant_msg_id),
            role=MensagemRole.ASSISTANT,
            conteudo=analysis.user_response,
            meta={
                "intent": analysis.intent.value,
                "next_best_question": analysis.next_best_question,
                "suggested_actions": [a.model_dump() for a in analysis.suggested_actions],
            },
            criado_em=datetime.now(timezone.utc),
        ))

        # 5) facts
        fact_ids: list[str] = []
        for f in analysis.facts_to_add:
            fid = str(uuid.uuid4())
            st["facts"].append({
                "id": fid, "tipo": f.tipo, "valor": f.valor,
                "confianca": f.confianca, "confirmado": f.confirmado,
                "fonte_mensagem_id": user_msg_id,
                "criado_em": datetime.now(timezone.utc).isoformat(),
            })
            fact_ids.append(fid)

        # 6) decisões (G18 in-memory)
        decision_ids: list[str] = []
        for d in analysis.decisions_to_add:
            if d.fonte.value == "sistema":
                exists = any(
                    x for x in st["decisions"]
                    if x["tipo"] == d.tipo and x["fonte"] == "usuario"
                )
                if exists:
                    log.info("G18 mem: decisão usuário existe para %s, skip sistema", d.tipo)
                    continue
            did = str(uuid.uuid4())
            st["decisions"].append({
                "id": did, "tipo": d.tipo, "valor": d.valor,
                "justificativa": d.justificativa, "fonte": d.fonte.value,
                "fonte_mensagem_id": user_msg_id,
                "criado_em": datetime.now(timezone.utc).isoformat(),
            })
            decision_ids.append(did)

        # 7) checklist updates
        updated_keys: list[str] = []
        for upd in analysis.checklist_updates:
            seed = ce.get_seed_item(upd.item_key)
            if seed is None or seed["owner"] == "orgao":
                continue
            it = st["checklist"].get(upd.item_key)
            if it is None:
                continue
            it.status = upd.status
            if upd.valor is not None:
                it.valor = upd.valor
            if upd.justificativa:
                it.justificativa = upd.justificativa
            it.atualizado_em = datetime.now(timezone.utc)
            updated_keys.append(upd.item_key)

        return {
            "user_message_id": user_msg_id,
            "assistant_message_id": assistant_msg_id,
            "analysis": analysis.model_dump(),
            "persisted": {
                "facts": fact_ids,
                "decisions": decision_ids,
                "checklist_keys": updated_keys,
            },
        }

    async def stream_turn(
        self,
        *,
        contratacao_id: str,
        user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        import asyncio
        result = await self.handle_turn(
            contratacao_id=contratacao_id,
            user_message=user_message,
            anexos=anexos,
        )
        analysis = ConversationTurnAnalysis.model_validate(result["analysis"])
        text = analysis.user_response
        chunk = 24
        for i in range(0, len(text), chunk):
            yield "assistant_token", {"text": text[i:i + chunk]}
            await asyncio.sleep(0.01)
        if analysis.facts_to_add:
            yield "facts_added", {"facts": [f.model_dump() for f in analysis.facts_to_add]}
        if analysis.decisions_to_add:
            yield "decisions_added", {"decisions": [d.model_dump() for d in analysis.decisions_to_add]}
        if analysis.checklist_updates:
            yield "checklist_updated", {
                "updates": [u.model_dump() for u in analysis.checklist_updates],
                "keys": result["persisted"]["checklist_keys"],
            }
        if analysis.price_sources_to_add:
            yield "price_sources_added", {
                "sources": [p.model_dump() for p in analysis.price_sources_to_add]
            }
        yield "turn_complete", {
            "message_id": result["assistant_message_id"],
            "intent": analysis.intent.value,
            "next_best_question": analysis.next_best_question,
            "suggested_actions": [a.model_dump() for a in analysis.suggested_actions],
        }

    async def list_history(
        self, contratacao_id: str, limit: int = 50,
        before: Optional[datetime] = None,
    ) -> list[MensagemOut]:
        st = self._state(contratacao_id)
        msgs = list(st["mensagens"])
        if before:
            msgs = [m for m in msgs if m.criado_em < before]
        return msgs[-limit:]

    async def get_checklist(self, contratacao_id: str) -> ChecklistResponse:
        await self.ensure_seed(contratacao_id)
        st = self._state(contratacao_id)
        items = list(st["checklist"].values())
        by_cat: dict[str, list[ChecklistItem]] = {}
        for it in items:
            by_cat.setdefault(it.categoria, []).append(it)
        summary = ChecklistSummary(
            total=len(items),
            confirmado=sum(1 for it in items if it.status == ChecklistStatus.CONFIRMADO),
            inferido=sum(1 for it in items if it.status == ChecklistStatus.INFERIDO),
            pendente=sum(1 for it in items if it.status == ChecklistStatus.PENDENTE),
            dispensado=sum(1 for it in items if it.status == ChecklistStatus.DISPENSADO),
            bloqueante_pendente=sum(
                1 for it in items
                if it.criticidade == ChecklistCriticidade.BLOQUEANTE
                and it.status == ChecklistStatus.PENDENTE
                and it.owner != ChecklistOwner.ORGAO
            ),
        )
        return ChecklistResponse(by_category=by_cat, summary=summary)

    async def patch_checklist_item(
        self,
        contratacao_id: str,
        item_key: str,
        *,
        status: ChecklistStatus,
        valor: Optional[Any] = None,
        justificativa: Optional[str] = None,
    ) -> Optional[ChecklistItem]:
        await self.ensure_seed(contratacao_id)
        st = self._state(contratacao_id)
        it = st["checklist"].get(item_key)
        if it is None:
            return None
        if status == ChecklistStatus.DISPENSADO and not justificativa:
            raise ValueError("Dispensar item exige justificativa.")
        it.status = status
        if valor is not None:
            it.valor = valor
        if justificativa:
            it.justificativa = justificativa
        it.atualizado_em = datetime.now(timezone.utc)
        return it


# ─────────────────────────────────────────────────────────────────────────────
# Postgres backend (produção)
# ─────────────────────────────────────────────────────────────────────────────

class PostgresCopilotBackend:
    async def ensure_seed(self, contratacao_id: str) -> None:
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            items = await ce.list_items(s, contratacao_id)
            if not items:
                await ce.seed_checklist(s, contratacao_id)

    async def handle_turn(
        self, *, contratacao_id: str, user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> dict[str, Any]:
        from xerticaproc.backend.agents.conversation_orchestrator import handle_turn
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await handle_turn(
                s, contratacao_id=contratacao_id,
                user_message=user_message, anexos=anexos,
            )

    async def stream_turn(
        self, *, contratacao_id: str, user_message: str,
        anexos: Optional[list[Anexo]] = None,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        from xerticaproc.backend.agents.conversation_orchestrator import (
            handle_turn_stream,
        )
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            async for ev, data in handle_turn_stream(
                s, contratacao_id=contratacao_id,
                user_message=user_message, anexos=anexos,
            ):
                yield ev, data

    async def list_history(
        self, contratacao_id: str, limit: int = 50,
        before: Optional[datetime] = None,
    ) -> list[MensagemOut]:
        from xerticaproc.backend.tools import conversation_store as cs
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await cs.list_messages(s, contratacao_id, limit=limit, before=before)

    async def get_checklist(self, contratacao_id: str) -> ChecklistResponse:
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            items = await ce.list_items(s, contratacao_id)
            if not items:
                await ce.seed_checklist(s, contratacao_id)
            return await ce.get_response(s, contratacao_id)

    async def patch_checklist_item(
        self, contratacao_id: str, item_key: str, *,
        status: ChecklistStatus,
        valor: Optional[Any] = None,
        justificativa: Optional[str] = None,
    ) -> Optional[ChecklistItem]:
        from xerticaproc.backend.tools.pg_tools import get_session
        async with get_session() as s:
            return await ce.update_item(
                s, contratacao_id, item_key,
                status=status, valor=valor, justificativa=justificativa,
                allow_orgao_override=True,  # PATCH explícito do usuário pode override
            )


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────

_backend: Optional[CopilotBackend] = None


def get_backend() -> CopilotBackend:
    global _backend
    if _backend is None:
        if os.environ.get("ALLOYDB_URL"):
            log.info("CopilotBackend: PostgresCopilotBackend (ALLOYDB_URL set)")
            _backend = PostgresCopilotBackend()
        else:
            log.info("CopilotBackend: InMemoryCopilotBackend (dev mode)")
            _backend = InMemoryCopilotBackend()
    return _backend
