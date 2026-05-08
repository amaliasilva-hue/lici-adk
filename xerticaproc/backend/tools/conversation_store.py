"""Conversation Store — persistência de conversas, mensagens, facts, decisões.

Camada fina sobre AlloyDB para o ConversationOrchestrator.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from xerticaproc.backend.models.copilot_schemas import (
    Anexo,
    ConversationTurnAnalysis,
    FonteOrigem,
    MensagemOut,
    MensagemRole,
)

log = logging.getLogger(__name__)


# ─── conversas ───────────────────────────────────────────────────────────────

async def get_or_create_conversa(
    session: AsyncSession, contratacao_id: str | UUID
) -> str:
    cid = str(contratacao_id)
    row = (await session.execute(
        text("SELECT conversa_ativa_id FROM contratacoes WHERE id = :cid"),
        {"cid": cid},
    )).first()
    if row and row.conversa_ativa_id:
        return str(row.conversa_ativa_id)

    new_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO conversas (id, contratacao_id) VALUES (:id, :cid)
        """),
        {"id": new_id, "cid": cid},
    )
    await session.execute(
        text("UPDATE contratacoes SET conversa_ativa_id = :cv WHERE id = :cid"),
        {"cv": new_id, "cid": cid},
    )
    return new_id


async def update_resumo(
    session: AsyncSession, conversa_id: str, resumo: str
) -> None:
    await session.execute(
        text("""
            UPDATE conversas SET resumo = :r, atualizado_em = NOW()
             WHERE id = :id
        """),
        {"r": resumo, "id": conversa_id},
    )


async def get_resumo(session: AsyncSession, conversa_id: str) -> Optional[str]:
    row = (await session.execute(
        text("SELECT resumo FROM conversas WHERE id = :id"),
        {"id": conversa_id},
    )).first()
    return row.resumo if row else None


# ─── mensagens ───────────────────────────────────────────────────────────────

async def append_message(
    session: AsyncSession,
    *,
    conversa_id: str,
    contratacao_id: str | UUID,
    role: MensagemRole,
    conteudo: str,
    meta: dict[str, Any] | None = None,
    anexos: list[Anexo] | None = None,
) -> str:
    msg_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO mensagens
              (id, conversa_id, contratacao_id, role, conteudo, meta, anexos)
            VALUES
              (:id, :cv, :cid, :role::mensagem_role,
               :ct, :meta::jsonb, :anexos::jsonb)
        """),
        {
            "id": msg_id,
            "cv": conversa_id,
            "cid": str(contratacao_id),
            "role": role.value,
            "ct": conteudo,
            "meta": json.dumps(meta or {}, ensure_ascii=False, default=str),
            "anexos": json.dumps([a.model_dump() for a in (anexos or [])],
                                  ensure_ascii=False, default=str),
        },
    )
    return msg_id


async def list_messages(
    session: AsyncSession,
    contratacao_id: str | UUID,
    *,
    limit: int = 50,
    before: Optional[datetime] = None,
) -> list[MensagemOut]:
    params: dict[str, Any] = {"cid": str(contratacao_id), "lim": limit}
    where = "contratacao_id = :cid"
    if before is not None:
        where += " AND criado_em < :bf"
        params["bf"] = before
    rows = await session.execute(
        text(f"""
            SELECT id, role, conteudo, meta, anexos, criado_em
              FROM mensagens
             WHERE {where}
             ORDER BY criado_em DESC
             LIMIT :lim
        """),
        params,
    )
    out: list[MensagemOut] = []
    for r in rows:
        out.append(MensagemOut(
            id=r.id,
            role=MensagemRole(r.role),
            conteudo=r.conteudo,
            meta=r.meta or {},
            anexos=[Anexo(**a) for a in (r.anexos or [])],
            criado_em=r.criado_em,
        ))
    out.reverse()
    return out


async def recent_messages_for_context(
    session: AsyncSession, contratacao_id: str | UUID, n: int = 8
) -> list[dict[str, str]]:
    """Últimas N mensagens em formato compacto para enviar ao LLM."""
    msgs = await list_messages(session, contratacao_id, limit=n)
    return [{"role": m.role.value, "content": m.conteudo} for m in msgs]


# ─── facts ───────────────────────────────────────────────────────────────────

async def add_fact(
    session: AsyncSession,
    *,
    contratacao_id: str | UUID,
    tipo: str,
    valor: Any,
    fonte_mensagem_id: Optional[str] = None,
    confianca: float = 0.7,
    confirmado: bool = False,
) -> str:
    fid = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO facts
              (id, contratacao_id, tipo, valor, fonte_mensagem_id,
               confianca, confirmado)
            VALUES
              (:id, :cid, :tp, :val::jsonb, :msg, :conf, :ok)
        """),
        {
            "id": fid,
            "cid": str(contratacao_id),
            "tp": tipo,
            "val": json.dumps(valor, ensure_ascii=False, default=str),
            "msg": fonte_mensagem_id,
            "conf": confianca,
            "ok": confirmado,
        },
    )
    return fid


async def list_facts(
    session: AsyncSession, contratacao_id: str | UUID
) -> list[dict[str, Any]]:
    rows = await session.execute(
        text("""
            SELECT id, tipo, valor, confianca, confirmado, criado_em
              FROM facts
             WHERE contratacao_id = :cid
             ORDER BY criado_em DESC
        """),
        {"cid": str(contratacao_id)},
    )
    return [
        {"id": str(r.id), "tipo": r.tipo, "valor": r.valor,
         "confianca": float(r.confianca), "confirmado": r.confirmado,
         "criado_em": r.criado_em.isoformat()}
        for r in rows
    ]


# ─── decisões ────────────────────────────────────────────────────────────────

async def add_decision(
    session: AsyncSession,
    *,
    contratacao_id: str | UUID,
    tipo: str,
    valor: Any,
    justificativa: Optional[str] = None,
    fonte: FonteOrigem = FonteOrigem.USUARIO,
    fonte_mensagem_id: Optional[str] = None,
    confirmado_por: Optional[str] = None,
) -> str:
    """Adiciona decisão. Aplica G18: decisão de fonte=usuario tem precedência."""
    # G18: se já existe decisão de fonte=usuario para este tipo e a nova vem
    # do sistema, não sobrescreve — apenas registra como inferência paralela.
    if fonte == FonteOrigem.SISTEMA:
        existing = (await session.execute(
            text("""
                SELECT 1 FROM decisoes_conversa
                 WHERE contratacao_id = :cid AND tipo = :tp
                   AND fonte = 'usuario'::fonte_origem
                 LIMIT 1
            """),
            {"cid": str(contratacao_id), "tp": tipo},
        )).first()
        if existing:
            log.info("G18: decisão de usuário já existe para %s, sistema não sobrescreve.", tipo)
            return ""

    did = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO decisoes_conversa
              (id, contratacao_id, tipo, valor, justificativa,
               fonte, fonte_mensagem_id, confirmado_por)
            VALUES
              (:id, :cid, :tp, :val::jsonb, :just,
               :fonte::fonte_origem, :msg, :who)
        """),
        {
            "id": did,
            "cid": str(contratacao_id),
            "tp": tipo,
            "val": json.dumps(valor, ensure_ascii=False, default=str),
            "just": justificativa,
            "fonte": fonte.value,
            "msg": fonte_mensagem_id,
            "who": confirmado_por,
        },
    )
    return did


async def list_decisions(
    session: AsyncSession, contratacao_id: str | UUID
) -> list[dict[str, Any]]:
    rows = await session.execute(
        text("""
            SELECT id, tipo, valor, justificativa, fonte,
                   confirmado_por, criado_em
              FROM decisoes_conversa
             WHERE contratacao_id = :cid
             ORDER BY criado_em DESC
        """),
        {"cid": str(contratacao_id)},
    )
    return [
        {"id": str(r.id), "tipo": r.tipo, "valor": r.valor,
         "justificativa": r.justificativa, "fonte": r.fonte,
         "confirmado_por": r.confirmado_por,
         "criado_em": r.criado_em.isoformat()}
        for r in rows
    ]


# ─── persistir saída do orchestrator ────────────────────────────────────────

async def persist_turn_analysis(
    session: AsyncSession,
    *,
    contratacao_id: str | UUID,
    user_message_id: str,
    assistant_message_id: str,
    analysis: ConversationTurnAnalysis,
) -> dict[str, list[str]]:
    """Persiste fatos, decisões e checklist updates da análise.
    Retorna ids criados por categoria."""
    from xerticaproc.backend.agents import checklist_engine as ce

    fact_ids: list[str] = []
    for f in analysis.facts_to_add:
        fact_ids.append(await add_fact(
            session,
            contratacao_id=contratacao_id,
            tipo=f.tipo, valor=f.valor,
            fonte_mensagem_id=user_message_id,
            confianca=f.confianca,
            confirmado=f.confirmado,
        ))

    decision_ids: list[str] = []
    for d in analysis.decisions_to_add:
        did = await add_decision(
            session,
            contratacao_id=contratacao_id,
            tipo=d.tipo, valor=d.valor,
            justificativa=d.justificativa,
            fonte=d.fonte,
            fonte_mensagem_id=user_message_id,
        )
        if did:
            decision_ids.append(did)

    updated_keys: list[str] = []
    for upd in analysis.checklist_updates:
        item = await ce.update_item(
            session,
            contratacao_id=contratacao_id,
            item_key=upd.item_key,
            status=upd.status,
            valor=upd.valor,
            justificativa=upd.justificativa,
        )
        if item is not None:
            updated_keys.append(upd.item_key)

    return {
        "facts": fact_ids,
        "decisions": decision_ids,
        "checklist_keys": updated_keys,
    }
