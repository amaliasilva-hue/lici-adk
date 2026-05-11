"""Store da Biblioteca de Documentos (sprint MVP).

Operações puras de persistência (sem regras de negócio). O processamento
(extract/thumb/embed) vive em `documentos_pipeline.py`.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from xerticaproc.backend.models.copilot_schemas import (
    Documento,
    DocumentoOrigem,
    DocumentoStatus,
)


# ─── helpers ────────────────────────────────────────────────────────────────

def _row_to_documento(r: Any) -> Documento:
    return Documento(
        id=r.id,
        contratacao_id=r.contratacao_id,
        nome=r.nome,
        mime=r.mime,
        bytes_size=r.bytes_size or 0,
        pages=r.pages,
        sha256=r.sha256,
        origem=DocumentoOrigem(r.origem),
        origem_ref=r.origem_ref or {},
        storage_uri=r.storage_uri,
        thumb_uri=r.thumb_uri,
        preview_uri=r.preview_uri,
        text_excerpt=r.text_excerpt,
        status=DocumentoStatus(r.status),
        meta=r.meta or {},
        uploaded_by=r.uploaded_by,
        criado_em=r.criado_em,
        processado_em=r.processado_em,
    )


# ─── reads ──────────────────────────────────────────────────────────────────

async def find_by_sha(
    session: AsyncSession,
    *,
    contratacao_id: str,
    sha256: str,
) -> Optional[Documento]:
    row = (await session.execute(
        text("""
            SELECT * FROM documentos
             WHERE contratacao_id = :cid AND sha256 = :sha
             LIMIT 1
        """),
        {"cid": contratacao_id, "sha": sha256},
    )).first()
    return _row_to_documento(row) if row else None


async def get_by_id(
    session: AsyncSession,
    *,
    contratacao_id: str,
    documento_id: str,
) -> Optional[Documento]:
    row = (await session.execute(
        text("""
            SELECT * FROM documentos
             WHERE contratacao_id = :cid AND id = :id
             LIMIT 1
        """),
        {"cid": contratacao_id, "id": documento_id},
    )).first()
    return _row_to_documento(row) if row else None


async def list_documentos(
    session: AsyncSession,
    *,
    contratacao_id: str,
    origem: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[Documento], int]:
    where = ["contratacao_id = :cid", "status <> 'arquivado'"]
    params: dict[str, Any] = {"cid": contratacao_id, "lim": limit, "off": offset}
    if origem:
        where.append("origem = :origem")
        params["origem"] = origem
    if status:
        where.append("status = :status")
        params["status"] = status
    if q:
        where.append("(nome ILIKE :q OR text_excerpt ILIKE :q)")
        params["q"] = f"%{q}%"

    where_sql = " AND ".join(where)
    rows = (await session.execute(
        text(f"""
            SELECT * FROM documentos
             WHERE {where_sql}
             ORDER BY criado_em DESC
             LIMIT :lim OFFSET :off
        """),
        params,
    )).fetchall()

    total = (await session.execute(
        text(f"SELECT COUNT(*) AS n FROM documentos WHERE {where_sql}"),
        params,
    )).scalar_one()

    return [_row_to_documento(r) for r in rows], int(total or 0)


# ─── writes ─────────────────────────────────────────────────────────────────

async def insert_documento(
    session: AsyncSession,
    *,
    contratacao_id: str,
    nome: str,
    mime: str,
    bytes_size: int,
    sha256: str,
    storage_uri: str,
    origem: DocumentoOrigem,
    origem_ref: Optional[dict[str, Any]] = None,
    uploaded_by: Optional[str] = None,
    status: DocumentoStatus = DocumentoStatus.PROCESSANDO,
) -> str:
    doc_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO documentos
              (id, contratacao_id, nome, mime, bytes_size, sha256, storage_uri,
               origem, origem_ref, status, uploaded_by)
            VALUES
              (:id, :cid, :nome, :mime, :sz, :sha, :uri,
               CAST(:origem AS documento_origem),
               CAST(:oref AS jsonb),
               CAST(:status AS documento_status),
               :ub)
        """),
        {
            "id": doc_id,
            "cid": contratacao_id,
            "nome": nome,
            "mime": mime,
            "sz": bytes_size,
            "sha": sha256,
            "uri": storage_uri,
            "origem": origem.value,
            "oref": json.dumps(origem_ref or {}, ensure_ascii=False, default=str),
            "status": status.value,
            "ub": uploaded_by,
        },
    )
    return doc_id


async def update_processed(
    session: AsyncSession,
    *,
    documento_id: str,
    status: DocumentoStatus,
    pages: Optional[int] = None,
    text_excerpt: Optional[str] = None,
    thumb_uri: Optional[str] = None,
    preview_uri: Optional[str] = None,
    meta_patch: Optional[dict[str, Any]] = None,
) -> None:
    sets = ["status = CAST(:status AS documento_status)",
            "processado_em = NOW()"]
    params: dict[str, Any] = {"id": documento_id, "status": status.value}
    if pages is not None:
        sets.append("pages = :pages"); params["pages"] = pages
    if text_excerpt is not None:
        sets.append("text_excerpt = :te"); params["te"] = text_excerpt[:60000]
    if thumb_uri is not None:
        sets.append("thumb_uri = :tu"); params["tu"] = thumb_uri
    if preview_uri is not None:
        sets.append("preview_uri = :pu"); params["pu"] = preview_uri
    if meta_patch:
        sets.append("meta = COALESCE(meta, '{}'::jsonb) || CAST(:mp AS jsonb)")
        params["mp"] = json.dumps(meta_patch, ensure_ascii=False, default=str)
    await session.execute(
        text(f"UPDATE documentos SET {', '.join(sets)} WHERE id = :id"),
        params,
    )


async def patch_documento(
    session: AsyncSession,
    *,
    contratacao_id: str,
    documento_id: str,
    nome: Optional[str] = None,
    meta_patch: Optional[dict[str, Any]] = None,
) -> Optional[Documento]:
    sets: list[str] = []
    params: dict[str, Any] = {"id": documento_id, "cid": contratacao_id}
    if nome is not None:
        sets.append("nome = :nome"); params["nome"] = nome
    if meta_patch:
        sets.append("meta = COALESCE(meta, '{}'::jsonb) || CAST(:mp AS jsonb)")
        params["mp"] = json.dumps(meta_patch, ensure_ascii=False, default=str)
    if not sets:
        return await get_by_id(session, contratacao_id=contratacao_id,
                                documento_id=documento_id)
    await session.execute(
        text(f"UPDATE documentos SET {', '.join(sets)} "
              "WHERE id = :id AND contratacao_id = :cid"),
        params,
    )
    return await get_by_id(session, contratacao_id=contratacao_id,
                            documento_id=documento_id)


async def soft_delete(
    session: AsyncSession,
    *,
    contratacao_id: str,
    documento_id: str,
) -> bool:
    res = await session.execute(
        text("""
            UPDATE documentos
               SET status = 'arquivado'
             WHERE id = :id AND contratacao_id = :cid
            RETURNING id
        """),
        {"id": documento_id, "cid": contratacao_id},
    )
    return res.first() is not None


# ─── ref mensagem↔documento ────────────────────────────────────────────────

async def link_message_documento(
    session: AsyncSession,
    *,
    mensagem_id: str,
    documento_id: str,
    papel: str,
    trechos: Optional[list[dict[str, Any]]] = None,
) -> None:
    await session.execute(
        text("""
            INSERT INTO mensagem_documento_refs
              (mensagem_id, documento_id, papel, trechos)
            VALUES
              (:mid, :did, :papel, CAST(:tr AS jsonb))
            ON CONFLICT (mensagem_id, documento_id, papel) DO NOTHING
        """),
        {
            "mid": mensagem_id,
            "did": documento_id,
            "papel": papel,
            "tr": json.dumps(trechos or [], ensure_ascii=False, default=str),
        },
    )


async def list_documentos_for_message(
    session: AsyncSession, *, mensagem_id: str,
) -> list[tuple[Documento, str]]:
    rows = (await session.execute(
        text("""
            SELECT d.*, r.papel
              FROM mensagem_documento_refs r
              JOIN documentos d ON d.id = r.documento_id
             WHERE r.mensagem_id = :mid
        """),
        {"mid": mensagem_id},
    )).fetchall()
    return [(_row_to_documento(r), r.papel) for r in rows]
