"""Persistência Postgres para Sprint B/C/D do Copilot.

Tabelas envolvidas (criadas em 002_copilot_schema.sql + 003_documentos_aprovacoes.sql):
  - fontes_usuario, pesquisas_negativas
  - documentos_gerados, aprovacoes, eventos_contratacao, readiness_snapshots

Camada fina sobre AsyncSession no padrão de conversation_store.py.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from xerticaproc.backend.models.copilot_schemas import (
    Aprovacao,
    AprovacaoIn,
    DocumentReadiness,
    DocumentoGeradoLite,
    EventoOut,
    FonteUsuario,
    FonteUsuarioIn,
    FonteUsuarioPatch,
    FonteUsuarioStatus,
    PesquisaNegativa,
    PesquisaNegativaIn,
)

log = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ─── Fontes de preço (Sprint B) ─────────────────────────────────────────────

async def insert_source(
    session: AsyncSession, contratacao_id: str, payload: FonteUsuarioIn,
) -> FonteUsuario:
    sid = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO fontes_usuario
              (id, contratacao_id, tipo, url, texto_colado, arquivo_gcs_uri,
               produto, observacao, status_validacao)
            VALUES
              (:id, :cid, :tipo, :url, :txt, :gcs, :prod, :obs, 'pendente')
        """),
        {
            "id": str(sid), "cid": contratacao_id,
            "tipo": payload.tipo, "url": payload.url,
            "txt": payload.texto_colado, "gcs": payload.arquivo_gcs_uri,
            "prod": payload.produto, "obs": payload.observacao,
        },
    )
    await session.commit()
    return FonteUsuario(
        id=sid, contratacao_id=contratacao_id,
        tipo=payload.tipo, status=FonteUsuarioStatus.PENDENTE,
        url=payload.url, texto_colado=payload.texto_colado,
        arquivo_gcs_uri=payload.arquivo_gcs_uri,
        produto=payload.produto, observacao=payload.observacao,
        criado_em=_utcnow(),
    )


async def update_source_validation(
    session: AsyncSession, src: FonteUsuario,
) -> None:
    await session.execute(
        text("""
            UPDATE fontes_usuario
               SET status_validacao = :st,
                   classificacao    = :cls,
                   valor_total      = :vt,
                   quantidade       = :qt,
                   vigencia_meses   = :vm,
                   observacao       = :obs
             WHERE id = :id
        """),
        {
            "id": str(src.id),
            "st":  src.status.value if src.status else "pendente",
            "cls": src.classificacao.value if src.classificacao else None,
            "vt":  src.valor_total,
            "qt":  src.quantidade,
            "vm":  src.vigencia_meses,
            "obs": src.observacao,
        },
    )
    await session.commit()


async def list_sources(
    session: AsyncSession, contratacao_id: str,
) -> list[FonteUsuario]:
    rows = (await session.execute(
        text("""
            SELECT id, tipo, url, texto_colado, arquivo_gcs_uri, produto,
                   valor_total, quantidade, vigencia_meses,
                   status_validacao, classificacao, observacao, criado_em
              FROM fontes_usuario
             WHERE contratacao_id = :cid
             ORDER BY criado_em DESC
        """),
        {"cid": contratacao_id},
    )).all()
    out: list[FonteUsuario] = []
    for r in rows:
        vt = float(r.valor_total) if r.valor_total is not None else None
        qt = float(r.quantidade) if r.quantidade is not None else None
        vmu: Optional[float] = None
        if vt is not None and qt and qt > 0 and r.vigencia_meses:
            vmu = vt / qt / r.vigencia_meses
        out.append(FonteUsuario(
            id=r.id, contratacao_id=contratacao_id, tipo=r.tipo,
            status=FonteUsuarioStatus(r.status_validacao or "pendente"),
            url=r.url, texto_colado=r.texto_colado,
            arquivo_gcs_uri=r.arquivo_gcs_uri, produto=r.produto,
            valor_total=vt, quantidade=qt,
            vigencia_meses=r.vigencia_meses,
            valor_mensal_unitario=vmu,
            classificacao=r.classificacao,
            observacao=r.observacao, criado_em=r.criado_em,
        ))
    return out


async def patch_source(
    session: AsyncSession, contratacao_id: str, source_id: str,
    payload: FonteUsuarioPatch,
) -> Optional[FonteUsuario]:
    sets: list[str] = []
    params: dict[str, Any] = {"id": source_id, "cid": contratacao_id}
    if payload.status is not None:
        sets.append("status_validacao = :st"); params["st"] = payload.status.value
    if payload.classificacao is not None:
        sets.append("classificacao = :cls"); params["cls"] = payload.classificacao.value
    if payload.observacao is not None:
        sets.append("observacao = :obs"); params["obs"] = payload.observacao
    if not sets:
        items = await list_sources(session, contratacao_id)
        return next((s for s in items if str(s.id) == source_id), None)
    await session.execute(
        text(
            f"UPDATE fontes_usuario SET {', '.join(sets)}"
            "  WHERE id = :id AND contratacao_id = :cid"
        ),
        params,
    )
    await session.commit()
    items = await list_sources(session, contratacao_id)
    return next((s for s in items if str(s.id) == source_id), None)


# ─── Pesquisas negativas (Sprint B) ─────────────────────────────────────────

async def insert_negative_search(
    session: AsyncSession, contratacao_id: str, payload: PesquisaNegativaIn,
) -> PesquisaNegativa:
    pid = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO pesquisas_negativas
              (id, contratacao_id, termo, fontes_consultadas, justificativa,
               efeito_na_estimativa)
            VALUES
              (:id, :cid, :termo, :fc::jsonb, :just, :ef)
        """),
        {
            "id": str(pid), "cid": contratacao_id,
            "termo": payload.termo,
            "fc": json.dumps(payload.fontes_consultadas),
            "just": payload.justificativa, "ef": payload.efeito_na_estimativa,
        },
    )
    await session.commit()
    return PesquisaNegativa(
        id=pid, contratacao_id=contratacao_id, criado_em=_utcnow(),
        **payload.model_dump(),
    )


async def list_negative_searches(
    session: AsyncSession, contratacao_id: str,
) -> list[PesquisaNegativa]:
    rows = (await session.execute(
        text("""
            SELECT id, termo, fontes_consultadas, justificativa,
                   efeito_na_estimativa, criado_em
              FROM pesquisas_negativas
             WHERE contratacao_id = :cid
             ORDER BY criado_em DESC
        """),
        {"cid": contratacao_id},
    )).all()
    return [
        PesquisaNegativa(
            id=r.id, contratacao_id=contratacao_id,
            termo=r.termo,
            fontes_consultadas=r.fontes_consultadas or [],
            justificativa=r.justificativa,
            efeito_na_estimativa=r.efeito_na_estimativa,
            criado_em=r.criado_em,
        ) for r in rows
    ]


# ─── Documentos gerados + readiness snapshots (Sprint C/D) ─────────────────

async def insert_documento(
    session: AsyncSession, contratacao_id: str,
    doc_type: str, content_md: str, readiness: DocumentReadiness,
) -> DocumentoGeradoLite:
    # Próxima versão
    row = (await session.execute(
        text("""
            SELECT COALESCE(MAX(versao), 0) AS v
              FROM documentos_gerados
             WHERE contratacao_id = :cid AND doc_type = :dt
        """),
        {"cid": contratacao_id, "dt": doc_type},
    )).first()
    versao = (row.v if row else 0) + 1

    did = uuid.uuid4()
    snap = readiness.model_dump(mode="json")
    await session.execute(
        text("""
            INSERT INTO documentos_gerados
              (id, contratacao_id, doc_type, versao, content_md, readiness_snapshot)
            VALUES
              (:id, :cid, :dt, :v, :md, :rd::jsonb)
        """),
        {
            "id": str(did), "cid": contratacao_id, "dt": doc_type,
            "v": versao, "md": content_md,
            "rd": json.dumps(snap, ensure_ascii=False, default=str),
        },
    )
    # Snapshot separado (auditoria)
    await session.execute(
        text("""
            INSERT INTO readiness_snapshots
              (id, contratacao_id, doc_type, can_generate, score,
               blocking_missing, optional_missing, inferred_items,
               open_fields_orgao, recommendations)
            VALUES
              (uuid_generate_v4(), :cid, :dt, :cg, :sc,
               :bm::jsonb, :om::jsonb, :ii::jsonb, :ofo::jsonb, :rec)
        """),
        {
            "cid": contratacao_id, "dt": doc_type,
            "cg": readiness.can_generate, "sc": readiness.score,
            "bm": json.dumps([m.model_dump() for m in readiness.blocking_missing]),
            "om": json.dumps([m.model_dump() for m in readiness.optional_missing]),
            "ii": json.dumps([m.model_dump() for m in readiness.inferred_items]),
            "ofo": json.dumps([m.model_dump() for m in readiness.open_fields_for_orgao]),
            "rec": readiness.recommendations,
        },
    )
    await emit_event(
        session, contratacao_id,
        tipo=f"documento_gerado.{doc_type}",
        payload={"documento_id": str(did), "versao": versao, "score": readiness.score},
        commit=False,
    )
    await session.commit()
    return DocumentoGeradoLite(
        id=did, contratacao_id=contratacao_id,
        doc_type=doc_type,  # type: ignore[arg-type]
        versao=versao, content_md=content_md,
        readiness_snapshot=readiness, gerado_em=_utcnow(),
    )


async def list_documentos(
    session: AsyncSession, contratacao_id: str,
) -> list[DocumentoGeradoLite]:
    rows = (await session.execute(
        text("""
            SELECT id, doc_type, versao, content_md, readiness_snapshot, gerado_em
              FROM documentos_gerados
             WHERE contratacao_id = :cid
             ORDER BY gerado_em DESC
        """),
        {"cid": contratacao_id},
    )).all()
    out: list[DocumentoGeradoLite] = []
    for r in rows:
        snap = r.readiness_snapshot
        if isinstance(snap, str):
            snap = json.loads(snap)
        out.append(DocumentoGeradoLite(
            id=r.id, contratacao_id=contratacao_id,
            doc_type=r.doc_type, versao=r.versao,
            content_md=r.content_md,
            readiness_snapshot=DocumentReadiness.model_validate(snap),
            gerado_em=r.gerado_em,
        ))
    return out


# ─── Aprovações ─────────────────────────────────────────────────────────────

async def insert_aprovacao(
    session: AsyncSession, contratacao_id: str, documento_id: str,
    payload: AprovacaoIn,
) -> Aprovacao:
    aid = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO aprovacoes
              (id, contratacao_id, documento_id, aprovado_por, papel, decisao, comentario)
            VALUES
              (:id, :cid, :did, :ap, :pap, :dec, :com)
        """),
        {
            "id": str(aid), "cid": contratacao_id, "did": documento_id,
            "ap": payload.aprovado_por, "pap": payload.papel,
            "dec": payload.decisao, "com": payload.comentario,
        },
    )
    await emit_event(
        session, contratacao_id,
        tipo=f"aprovacao.{payload.decisao}",
        payload={"documento_id": documento_id, "aprovado_por": payload.aprovado_por},
        commit=False,
    )
    await session.commit()
    return Aprovacao(
        id=aid, contratacao_id=contratacao_id,
        documento_id=UUID(documento_id), criado_em=_utcnow(),
        **payload.model_dump(),
    )


async def list_aprovacoes(
    session: AsyncSession, contratacao_id: str,
) -> list[Aprovacao]:
    rows = (await session.execute(
        text("""
            SELECT id, documento_id, aprovado_por, papel, decisao, comentario, criado_em
              FROM aprovacoes
             WHERE contratacao_id = :cid
             ORDER BY criado_em DESC
        """),
        {"cid": contratacao_id},
    )).all()
    return [
        Aprovacao(
            id=r.id, contratacao_id=contratacao_id, documento_id=r.documento_id,
            aprovado_por=r.aprovado_por, papel=r.papel,
            decisao=r.decisao, comentario=r.comentario, criado_em=r.criado_em,
        ) for r in rows
    ]


# ─── Eventos (timeline + bell) ───────────────────────────────────────────────

async def emit_event(
    session: AsyncSession, contratacao_id: str, *,
    tipo: str, payload: Optional[dict] = None,
    commit: bool = True,
) -> None:
    await session.execute(
        text("""
            INSERT INTO eventos_contratacao (contratacao_id, tipo, payload)
            VALUES (:cid, :tp, :pl::jsonb)
        """),
        {
            "cid": contratacao_id, "tp": tipo,
            "pl": json.dumps(payload or {}, ensure_ascii=False, default=str),
        },
    )
    if commit:
        await session.commit()


async def list_eventos(
    session: AsyncSession, contratacao_id: str, *,
    limit: int = 50, only_unread: bool = False,
) -> list[EventoOut]:
    where = "contratacao_id = :cid"
    if only_unread:
        where += " AND lido = FALSE"
    rows = (await session.execute(
        text(
            f"""SELECT id, tipo, payload, lido, criado_em
                  FROM eventos_contratacao
                 WHERE {where}
                 ORDER BY criado_em DESC
                 LIMIT :lim"""
        ),
        {"cid": contratacao_id, "lim": limit},
    )).all()
    return [
        EventoOut(
            id=r.id, contratacao_id=contratacao_id, tipo=r.tipo,
            payload=r.payload or {}, lido=r.lido, criado_em=r.criado_em,
        ) for r in rows
    ]


async def mark_eventos_read(
    session: AsyncSession, contratacao_id: str,
) -> int:
    res = await session.execute(
        text("""
            UPDATE eventos_contratacao SET lido = TRUE
             WHERE contratacao_id = :cid AND lido = FALSE
        """),
        {"cid": contratacao_id},
    )
    await session.commit()
    return res.rowcount or 0
