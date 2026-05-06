"""
pg_tools.py — AlloyDB (PostgreSQL) persistence layer for xerticaproc.

Uses asyncpg via SQLAlchemy async engine.
Connection string is read from the ALLOYDB_URL environment variable.

Pattern: async context manager for sessions, all public functions accept
a `session` parameter so callers can share a transaction.

Env vars:
  ALLOYDB_URL  — postgresql+asyncpg://user:pass@host/dbname
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, AsyncGenerator, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

log = logging.getLogger(__name__)

_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None

# ── Engine setup ──────────────────────────────────────────────────────────────

def _get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        url = os.environ.get("ALLOYDB_URL")
        if not url:
            raise RuntimeError("ALLOYDB_URL environment variable is not set")
        _engine = create_async_engine(
            url,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
            connect_args={"server_settings": {"application_name": "xerticaproc"}},
        )
    return _engine


def _get_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            _get_engine(), expire_on_commit=False, class_=AsyncSession
        )
    return _session_factory


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager that yields an AsyncSession and commits on exit."""
    async with _get_factory()() as session:
        async with session.begin():
            yield session


# ── contratacoes ──────────────────────────────────────────────────────────────

async def criar_contratacao(
    session: AsyncSession,
    *,
    id_orgao: str,
    nome_orgao: str,
    objeto_resumido: str,
    descricao_necessidade: str,
    uasg: Optional[str] = None,
    natureza_objeto: Optional[str] = None,
    valor_estimado_maximo: Optional[float] = None,
    prazo_vigencia_meses: Optional[int] = None,
    palavras_chave: list[str] | None = None,
    dfd_texto: Optional[str] = None,
) -> str:
    """Insert a new contratacao row. Returns the new UUID."""
    new_id = str(uuid.uuid4())
    await session.execute(
        text(
            """
            INSERT INTO contratacoes
              (id, id_orgao, nome_orgao, objeto_resumido, descricao_necessidade,
               uasg, natureza_objeto, valor_estimado_maximo, prazo_vigencia_meses,
               palavras_chave, dfd_texto)
            VALUES
              (:id, :id_orgao, :nome_orgao, :objeto_resumido, :descricao_necessidade,
               :uasg, :natureza_objeto::natureza_objeto, :valor_estimado_maximo,
               :prazo_vigencia_meses, :palavras_chave::text[], :dfd_texto)
            """
        ),
        {
            "id": new_id,
            "id_orgao": id_orgao,
            "nome_orgao": nome_orgao,
            "objeto_resumido": objeto_resumido,
            "descricao_necessidade": descricao_necessidade,
            "uasg": uasg,
            "natureza_objeto": natureza_objeto,
            "valor_estimado_maximo": valor_estimado_maximo,
            "prazo_vigencia_meses": prazo_vigencia_meses,
            "palavras_chave": "{" + ",".join(palavras_chave or []) + "}",
            "dfd_texto": dfd_texto,
        },
    )
    return new_id


async def atualizar_status(
    session: AsyncSession, contratacao_id: str, status: str
) -> None:
    await session.execute(
        text(
            "UPDATE contratacoes SET status = :status::status_contratacao WHERE id = :id"
        ),
        {"status": status, "id": contratacao_id},
    )


async def salvar_bundle(
    session: AsyncSession, contratacao_id: str, bundle: dict[str, Any]
) -> None:
    await session.execute(
        text(
            "UPDATE contratacoes SET bundle_json = :bundle WHERE id = :id"
        ),
        {"bundle": json.dumps(bundle, ensure_ascii=False, default=str), "id": contratacao_id},
    )


async def salvar_mapa_precos(
    session: AsyncSession, contratacao_id: str, mapa: dict[str, Any]
) -> None:
    await session.execute(
        text(
            "UPDATE contratacoes SET mapa_precos_json = :mapa, status = 'pesquisa_precos'::status_contratacao WHERE id = :id"
        ),
        {"mapa": json.dumps(mapa, ensure_ascii=False, default=str), "id": contratacao_id},
    )


async def salvar_documento(
    session: AsyncSession,
    contratacao_id: str,
    tipo: str,  # 'ETP' or 'TR'
    conteudo_markdown: str,
    pendencias: list[str],
    tokens_usados: Optional[int] = None,
    versao: int = 1,
) -> str:
    doc_id = str(uuid.uuid4())
    col = "etp_json" if tipo == "ETP" else "tr_json"
    await session.execute(
        text(
            """
            INSERT INTO documentos
              (id, contratacao_id, tipo_documento, versao, conteudo_markdown,
               pendencias, tokens_usados)
            VALUES
              (:id, :cid, :tipo::tipo_documento, :versao, :md, :pend::text[], :tokens)
            """
        ),
        {
            "id": doc_id,
            "cid": contratacao_id,
            "tipo": tipo,
            "versao": versao,
            "md": conteudo_markdown,
            "pend": "{" + ",".join(pendencias) + "}",
            "tokens": tokens_usados,
        },
    )
    # also update denormalized column in contratacoes for fast reads
    doc_summary = {
        "id": doc_id,
        "tipo_documento": tipo,
        "versao": versao,
        "conteudo_markdown": conteudo_markdown,
        "pendencias": pendencias,
        "tokens_usados": tokens_usados,
        "gerado_em": datetime.utcnow().isoformat(),
    }
    await session.execute(
        text(f"UPDATE contratacoes SET {col} = :v WHERE id = :id"),  # noqa: S608 — col is controlled
        {"v": json.dumps(doc_summary, ensure_ascii=False, default=str), "id": contratacao_id},
    )
    return doc_id


async def buscar_contratacao(
    session: AsyncSession, contratacao_id: str
) -> Optional[dict[str, Any]]:
    result = await session.execute(
        text("SELECT * FROM contratacoes WHERE id = :id"),
        {"id": contratacao_id},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else None


async def listar_contratacoes(
    session: AsyncSession,
    id_orgao: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    filters = ["1=1"]
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if id_orgao:
        filters.append("id_orgao = :id_orgao")
        params["id_orgao"] = id_orgao
    if status:
        filters.append("status = :status::status_contratacao")
        params["status"] = status
    where = " AND ".join(filters)
    result = await session.execute(
        text(
            f"SELECT id, status, objeto_resumido, nome_orgao, criado_em, atualizado_em "  # noqa: S608
            f"FROM contratacoes WHERE {where} "
            f"ORDER BY criado_em DESC LIMIT :limit OFFSET :offset"
        ),
        params,
    )
    return [dict(r) for r in result.mappings().fetchall()]


# ── jobs ──────────────────────────────────────────────────────────────────────

async def criar_job(
    session: AsyncSession,
    contratacao_id: str,
    etapa: Optional[str] = None,
) -> str:
    job_id = str(uuid.uuid4())
    await session.execute(
        text(
            "INSERT INTO jobs (id, contratacao_id, etapa) VALUES (:id, :cid, :etapa)"
        ),
        {"id": job_id, "cid": contratacao_id, "etapa": etapa},
    )
    return job_id


async def atualizar_job(
    session: AsyncSession,
    job_id: str,
    *,
    status: str,
    progresso: int = 0,
    erro: Optional[str] = None,
    resultado: Optional[dict[str, Any]] = None,
) -> None:
    concluido_em = "NOW()" if status in ("done", "failed") else "NULL"
    await session.execute(
        text(
            f"""
            UPDATE jobs SET
              status      = :status,
              progresso   = :progresso,
              erro        = :erro,
              resultado   = :resultado,
              concluido_em = {concluido_em}
            WHERE id = :id
            """
        ),
        {
            "status": status,
            "progresso": progresso,
            "erro": erro,
            "resultado": json.dumps(resultado, default=str) if resultado else None,
            "id": job_id,
        },
    )


async def buscar_job(
    session: AsyncSession, job_id: str
) -> Optional[dict[str, Any]]:
    result = await session.execute(
        text("SELECT * FROM jobs WHERE id = :id"),
        {"id": job_id},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else None


# ── itens_preco ───────────────────────────────────────────────────────────────

async def inserir_itens_preco(
    session: AsyncSession,
    contratacao_id: str,
    itens: list[dict[str, Any]],
) -> None:
    """Bulk-insert price items (ignores duplicates by url_evidencia + valor)."""
    if not itens:
        return
    for item in itens:
        await session.execute(
            text(
                """
                INSERT INTO itens_preco
                  (id, contratacao_id, fonte, tipo_fonte, descricao_licitada,
                   valor_unitario, unidade, quantidade, vigencia_meses,
                   data_referencia, orgao_comprador, numero_processo,
                   url_evidencia, score_comparabilidade, flags_qualidade)
                VALUES
                  (uuid_generate_v4(), :cid, :fonte, :tipo_fonte::tipo_fonte_mercado,
                   :descricao, :valor, :unidade, :quantidade, :vigencia,
                   :data_ref, :orgao, :processo, :url, :score, :flags::text[])
                ON CONFLICT DO NOTHING
                """
            ),
            {
                "cid": contratacao_id,
                "fonte": item.get("fonte", ""),
                "tipo_fonte": item.get("tipo_fonte", "outro"),
                "descricao": item.get("descricao_licitada", ""),
                "valor": item.get("valor_unitario", 0),
                "unidade": item.get("unidade", "UN"),
                "quantidade": item.get("quantidade"),
                "vigencia": item.get("vigencia_meses"),
                "data_ref": item.get("data_referencia"),
                "orgao": item.get("orgao_comprador"),
                "processo": item.get("numero_processo"),
                "url": item.get("url_evidencia"),
                "score": item.get("score_comparabilidade", 0.0),
                "flags": "{" + ",".join(item.get("flags_qualidade", [])) + "}",
            },
        )


# ── audit ─────────────────────────────────────────────────────────────────────

async def registrar_audit(
    session: AsyncSession,
    acao: str,
    contratacao_id: Optional[str] = None,
    detalhes: Optional[dict[str, Any]] = None,
    usuario: Optional[str] = None,
) -> None:
    await session.execute(
        text(
            """
            INSERT INTO audit_log (contratacao_id, acao, detalhes, usuario)
            VALUES (:cid, :acao, :det, :usr)
            """
        ),
        {
            "cid": contratacao_id,
            "acao": acao,
            "det": json.dumps(detalhes, default=str) if detalhes else None,
            "usr": usuario,
        },
    )
