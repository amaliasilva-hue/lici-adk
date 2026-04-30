"""chat_store — CRUD para sessões e mensagens de chat (PostgreSQL).

Tabelas: chat_sessions, chat_messages (DDL em pg_tools.py)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from backend.tools.pg_tools import get_engine, _serialize_row

log = logging.getLogger("lici_adk.chat_store")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row(r: Any) -> dict:
    """Converte RowMapping/Row SQLAlchemy para dict JSON-safe."""
    if hasattr(r, "_asdict"):
        return _serialize_row(r._asdict())
    if hasattr(r, "_mapping"):
        return _serialize_row(dict(r._mapping))
    return _serialize_row(dict(r))


# ── Sessions ──────────────────────────────────────────────────────────────────

def create_session(
    title: str = "Nova conversa",
    edital_id: str | None = None,
    user_email: str | None = None,
) -> dict:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "INSERT INTO chat_sessions (title, edital_id, user_email) "
                "VALUES (:title, :edital_id, :user_email) RETURNING *"
            ),
            {"title": title, "edital_id": edital_id, "user_email": user_email},
        ).fetchone()
        conn.commit()
    return _row(row)


def list_sessions(limit: int = 60) -> list[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT s.*, "
                "(SELECT content FROM chat_messages m WHERE m.session_id = s.session_id "
                " ORDER BY m.created_at DESC LIMIT 1) AS last_message, "
                "(SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.session_id) AS message_count "
                "FROM chat_sessions s "
                "ORDER BY s.updated_at DESC LIMIT :limit"
            ),
            {"limit": limit},
        ).fetchall()
    return [_row(r) for r in rows]


def get_session(session_id: str) -> dict | None:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM chat_sessions WHERE session_id = :sid LIMIT 1"),
            {"sid": session_id},
        ).fetchone()
    return _row(row) if row else None


def update_session_title(session_id: str, title: str) -> None:
    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(
            text("UPDATE chat_sessions SET title = :title, updated_at = NOW() WHERE session_id = :sid"),
            {"title": title, "sid": session_id},
        )
        conn.commit()


def _touch_session(session_id: str, conn: Any) -> None:
    conn.execute(
        text("UPDATE chat_sessions SET updated_at = NOW() WHERE session_id = :sid"),
        {"sid": session_id},
    )


def delete_session(session_id: str) -> bool:
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(
            text("DELETE FROM chat_sessions WHERE session_id = :sid"),
            {"sid": session_id},
        )
        conn.commit()
    return (result.rowcount or 0) > 0


# ── Messages ──────────────────────────────────────────────────────────────────

def add_message(
    session_id: str,
    role: str,
    content: str,
    attachments_meta: list[dict] | None = None,
) -> dict:
    engine = get_engine()
    meta_json = json.dumps(attachments_meta) if attachments_meta else None
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "INSERT INTO chat_messages (session_id, role, content, attachments_meta) "
                "VALUES (:sid, :role, :content, :meta::jsonb) RETURNING *"
            ),
            {"sid": session_id, "role": role, "content": content, "meta": meta_json},
        ).fetchone()
        _touch_session(session_id, conn)
        conn.commit()
    return _row(row)


def get_messages(session_id: str) -> list[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT * FROM chat_messages WHERE session_id = :sid "
                "ORDER BY created_at ASC"
            ),
            {"sid": session_id},
        ).fetchall()
    return [_row(r) for r in rows]


def get_session_with_messages(session_id: str) -> dict | None:
    session = get_session(session_id)
    if not session:
        return None
    msgs = get_messages(session_id)
    return {**session, "messages": msgs}
