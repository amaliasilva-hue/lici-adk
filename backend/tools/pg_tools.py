"""pg_tools — Acesso Postgres para cache de atestados (Fase 4).

Usa SQLAlchemy (engine síncrono) com psycopg2.
Em Cloud Run conecta via Cloud SQL Auth Proxy (socket Unix).
Em desenvolvimento usa `DATABASE_URL` direto.

Env vars:
  XLICI_PG_CONN   — Cloud SQL instance connection name
                    ex: "operaciones-br:us-central1:x-lici-pg"
                    Se definido, usa socket /cloudsql/<XLICI_PG_CONN>/.s.PGSQL.5432
  XLICI_DB_USER   — ex: "lici_app"
  XLICI_DB_PASS   — senha (ou lê do Secret Manager via XLICI_DB_SECRET_NAME)
  XLICI_DB_NAME   — ex: "xlici"
  DATABASE_URL    — URL completa (sobrescreve os campos acima; útil em dev/tests)
"""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

log = logging.getLogger("lici_adk.pg_tools")

# ── Configuração ─────────────────────────────────────────────────────────────

PG_CONN = os.getenv("XLICI_PG_CONN", "operaciones-br:us-central1:x-lici-pg")
DB_USER = os.getenv("XLICI_DB_USER", "lici_app")
DB_NAME = os.getenv("XLICI_DB_NAME", "xlici")
DB_SECRET = os.getenv("XLICI_DB_SECRET_NAME", "lici-db-password")
DATABASE_URL = os.getenv("DATABASE_URL", "")


def _read_secret(secret_name: str) -> str:
    """Lê secret do Secret Manager."""
    try:
        from google.cloud import secretmanager
        client = secretmanager.SecretManagerServiceClient()
        project = os.getenv("GOOGLE_CLOUD_PROJECT", "operaciones-br")
        name = f"projects/{project}/secrets/{secret_name}/versions/latest"
        resp = client.access_secret_version(request={"name": name})
        return resp.payload.data.decode("utf-8").strip()
    except Exception as exc:
        log.warning("pg.secret_read_failed", extra={"secret": secret_name, "error": str(exc)})
        return ""


@lru_cache(maxsize=1)
def _db_password() -> str:
    env_pass = os.getenv("XLICI_DB_PASS", "")
    return env_pass or _read_secret(DB_SECRET)


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Constrói e retorna o engine SQLAlchemy (singleton)."""
    if DATABASE_URL:
        url = DATABASE_URL
    else:
        password = _db_password()
        if PG_CONN:
            # Cloud SQL Auth Proxy via socket Unix
            socket_path = f"/cloudsql/{PG_CONN}"
            url = (
                f"postgresql+psycopg2://{DB_USER}:{password}@/{DB_NAME}"
                f"?host={socket_path}"
            )
        else:
            # Fallback TCP (dev local)
            host = os.getenv("XLICI_DB_HOST", "localhost")
            port = os.getenv("XLICI_DB_PORT", "5432")
            url = f"postgresql+psycopg2://{DB_USER}:{password}@{host}:{port}/{DB_NAME}"

    engine = create_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        connect_args={"connect_timeout": 10},
    )
    log.info("pg.engine_created", extra={"db_name": DB_NAME})
    return engine


# ── Schema ───────────────────────────────────────────────────────────────────

_DDL_ATESTADOS_CACHE = """
CREATE TABLE IF NOT EXISTS atestados_cache (
    edital_id          TEXT        PRIMARY KEY,
    somatorio_json     JSONB       NOT NULL,
    calculado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    drive_folder_id    TEXT,
    pdfs_processados   INT         NOT NULL DEFAULT 0,
    pdfs_com_erro      INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS atestados_cache_calculado_em_idx
    ON atestados_cache (calculado_em DESC);
"""

# ── Fase 6 — Sistema de Controle de Editais ──────────────────────────────────

_DDL_EDITAIS = """
CREATE TABLE IF NOT EXISTS editais (
    edital_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    orgao              TEXT        NOT NULL DEFAULT '',
    uf                 CHAR(2)     NOT NULL DEFAULT 'XX',
    uasg               TEXT,
    numero_pregao      TEXT,
    portal             TEXT,
    objeto             TEXT,
    valor_estimado     NUMERIC(15,2),
    data_encerramento  TIMESTAMPTZ,
    fase_atual         TEXT        NOT NULL DEFAULT 'identificacao',
    estado_terminal    TEXT,
    vendedor_email     TEXT,
    drive_folder_id    TEXT,
    drive_folder_url   TEXT,
    analysis_id_comercial UUID,
    analysis_id_juridica  UUID,
    classificacao      TEXT,
    risco              TEXT,
    prioridade         INTEGER     NOT NULL DEFAULT 3,
    score_comercial    NUMERIC(5,1),
    edital_filename    TEXT,
    result_json        JSONB,
    relatorio_juridico_json JSONB,
    criado_por         TEXT        NOT NULL DEFAULT 'sistema',
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS editais_fase_uf_idx ON editais (fase_atual, uf);
CREATE INDEX IF NOT EXISTS editais_vendedor_idx ON editais (vendedor_email);
CREATE INDEX IF NOT EXISTS editais_encerramento_idx ON editais (data_encerramento);
"""

_DDL_MOVIMENTACOES = """
CREATE TABLE IF NOT EXISTS edital_movimentacoes (
    mov_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    edital_id     UUID        NOT NULL REFERENCES editais(edital_id),
    fase_origem   TEXT        NOT NULL,
    fase_destino  TEXT        NOT NULL,
    autor_email   TEXT        NOT NULL,
    motivo        TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS edital_movimentacoes_edital_idx ON edital_movimentacoes (edital_id);
"""

_DDL_COMENTARIOS = """
CREATE TABLE IF NOT EXISTS edital_comentarios (
    comentario_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    edital_id      UUID        NOT NULL REFERENCES editais(edital_id),
    autor_email    TEXT        NOT NULL,
    texto          TEXT        NOT NULL,
    mencionados    TEXT[]      NOT NULL DEFAULT '{}',
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS edital_comentarios_edital_idx ON edital_comentarios (edital_id, criado_em DESC);
"""

_DDL_GATES = """
CREATE TABLE IF NOT EXISTS edital_gates (
    gate_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    edital_id     UUID        NOT NULL REFERENCES editais(edital_id),
    stage         TEXT        NOT NULL,
    gate_key      TEXT        NOT NULL,
    concluido     BOOLEAN     NOT NULL DEFAULT FALSE,
    concluido_em  TIMESTAMPTZ,
    concluido_por TEXT,
    UNIQUE (edital_id, stage, gate_key)
);
"""

_DDL_USUARIOS = """
CREATE TABLE IF NOT EXISTS usuarios (
    usuario_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        UNIQUE NOT NULL,
    nome        TEXT,
    papel       TEXT        NOT NULL DEFAULT 'vendedor',
    ativo       BOOLEAN     NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

# Gates padrão por stage
STAGE_GATES: dict[str, list[str]] = {
    "identificacao": ["edital_baixado", "orgao_identificado", "vendedor_atribuido"],
    "analise": ["analise_comercial_concluida", "analise_juridica_concluida"],
    "pre_disputa": ["prazo_verificado", "documentos_redigidos"],
    "proposta": ["proposta_tecnica_redigida", "proposta_comercial_precificada"],
    "disputa": ["credenciamento_portal", "proposta_enviada"],
    "habilitacao": ["kit_habilitacao_completo", "certidoes_validas"],
    "recursos": ["prazo_recurso_verificado", "contrarrazoes_redigidas"],
    "homologado": ["ata_salva_drive"],
}

STAGES_ORDER = ["identificacao", "analise", "pre_disputa", "proposta", "disputa", "habilitacao", "recursos", "homologado"]
ESTADOS_TERMINAIS = ["ganho", "perdido", "inabilitado", "revogado", "nao_participamos"]


_DDL_EDITAIS_MIGRATIONS = [
    # Adiciona colunas que podem estar faltando em tabelas já existentes (idempotente via IF NOT EXISTS)
    "ALTER TABLE editais ADD COLUMN IF NOT EXISTS score_comercial NUMERIC(5,1)",
    "ALTER TABLE editais ADD COLUMN IF NOT EXISTS edital_filename TEXT",
    "ALTER TABLE editais ADD COLUMN IF NOT EXISTS result_json JSONB",
    "ALTER TABLE editais ADD COLUMN IF NOT EXISTS relatorio_juridico_json JSONB",
    "ALTER TABLE editais ADD COLUMN IF NOT EXISTS edital_json_storage JSONB",
]


def ensure_schema() -> None:
    """Cria todas as tabelas Postgres se não existirem (idempotente)."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text(_DDL_ATESTADOS_CACHE))
            conn.execute(text(_DDL_EDITAIS))
            conn.execute(text(_DDL_MOVIMENTACOES))
            conn.execute(text(_DDL_COMENTARIOS))
            conn.execute(text(_DDL_GATES))
            conn.execute(text(_DDL_USUARIOS))
            # Migrations — adicionam colunas se não existirem (safe para tabelas já criadas)
            for migration in _DDL_EDITAIS_MIGRATIONS:
                conn.execute(text(migration))
            conn.commit()
        log.info("pg.schema_ok")
    except Exception as exc:
        log.error("pg.ensure_schema_failed", extra={"error": str(exc)})
        raise


# ── CRUD editais ──────────────────────────────────────────────────────────────

def create_edital(data: dict) -> dict:
    """Insere novo edital e retorna a row criada."""
    engine = get_engine()
    cols = ", ".join(data.keys())
    vals = ", ".join(f":{k}" for k in data.keys())
    with engine.connect() as conn:
        row = conn.execute(
            text(f"INSERT INTO editais ({cols}) VALUES ({vals}) RETURNING *"),
            data,
        ).fetchone()
        conn.commit()
    return dict(row._mapping)


def get_edital(edital_id: str) -> Optional[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM editais WHERE edital_id = :eid AND deleted_at IS NULL"),
            {"eid": edital_id},
        ).fetchone()
    return dict(row._mapping) if row else None


def list_editais(
    fase: str | None = None,
    uf: str | None = None,
    vendedor_email: str | None = None,
    limit: int = 50,
) -> list[dict]:
    engine = get_engine()
    wheres = ["deleted_at IS NULL"]
    params: dict = {"limit": min(limit, 200)}
    if fase:
        wheres.append("fase_atual = :fase")
        params["fase"] = fase
    if uf:
        wheres.append("uf = :uf")
        params["uf"] = uf
    if vendedor_email:
        wheres.append("vendedor_email = :ve")
        params["ve"] = vendedor_email
    where_sql = "WHERE " + " AND ".join(wheres)
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT * FROM editais {where_sql} ORDER BY atualizado_em DESC LIMIT :limit"),
            params,
        ).fetchall()
    return [dict(r._mapping) for r in rows]


def update_edital(edital_id: str, data: dict) -> Optional[dict]:
    if not data:
        return get_edital(edital_id)
    data["atualizado_em"] = "NOW()"
    sets = ", ".join(
        f"{k} = NOW()" if v == "NOW()" else f"{k} = :{k}"
        for k, v in data.items()
    )
    params = {k: v for k, v in data.items() if v != "NOW()"}
    params["eid"] = edital_id
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(f"UPDATE editais SET {sets} WHERE edital_id = :eid AND deleted_at IS NULL RETURNING *"),
            params,
        ).fetchone()
        conn.commit()
    return dict(row._mapping) if row else None


def soft_delete_edital(edital_id: str) -> bool:
    engine = get_engine()
    with engine.connect() as conn:
        result = conn.execute(
            text("UPDATE editais SET deleted_at = NOW() WHERE edital_id = :eid AND deleted_at IS NULL"),
            {"eid": edital_id},
        )
        conn.commit()
    return result.rowcount > 0


# ── CRUD movimentações ────────────────────────────────────────────────────────

def add_movimentacao(edital_id: str, fase_origem: str, fase_destino: str, autor_email: str, motivo: str | None = None) -> dict:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                INSERT INTO edital_movimentacoes (edital_id, fase_origem, fase_destino, autor_email, motivo)
                VALUES (:eid, :fo, :fd, :ae, :motivo) RETURNING *
            """),
            {"eid": edital_id, "fo": fase_origem, "fd": fase_destino, "ae": autor_email, "motivo": motivo},
        ).fetchone()
        conn.commit()
    return dict(row._mapping)


def list_movimentacoes(edital_id: str) -> list[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM edital_movimentacoes WHERE edital_id = :eid ORDER BY criado_em DESC"),
            {"eid": edital_id},
        ).fetchall()
    return [dict(r._mapping) for r in rows]


# ── CRUD comentários ──────────────────────────────────────────────────────────

def add_comentario(edital_id: str, autor_email: str, texto: str, mencionados: list[str] | None = None) -> dict:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                INSERT INTO edital_comentarios (edital_id, autor_email, texto, mencionados)
                VALUES (:eid, :ae, :texto, :mencionados) RETURNING *
            """),
            {"eid": edital_id, "ae": autor_email, "texto": texto, "mencionados": mencionados or []},
        ).fetchone()
        conn.commit()
    return dict(row._mapping)


def list_comentarios(edital_id: str, limit: int = 100) -> list[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM edital_comentarios WHERE edital_id = :eid ORDER BY criado_em ASC LIMIT :limit"),
            {"eid": edital_id, "limit": limit},
        ).fetchall()
    return [dict(r._mapping) for r in rows]


# ── CRUD gates ────────────────────────────────────────────────────────────────

def seed_gates(edital_id: str, stage: str) -> None:
    """Insere os gates padrão de um stage se ainda não existirem."""
    gate_keys = STAGE_GATES.get(stage, [])
    if not gate_keys:
        return
    engine = get_engine()
    with engine.connect() as conn:
        for key in gate_keys:
            conn.execute(
                text("""
                    INSERT INTO edital_gates (edital_id, stage, gate_key)
                    VALUES (:eid, :stage, :key)
                    ON CONFLICT (edital_id, stage, gate_key) DO NOTHING
                """),
                {"eid": edital_id, "stage": stage, "key": key},
            )
        conn.commit()


def list_gates(edital_id: str, stage: str | None = None) -> list[dict]:
    engine = get_engine()
    params: dict = {"eid": edital_id}
    extra = ""
    if stage:
        extra = " AND stage = :stage"
        params["stage"] = stage
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT * FROM edital_gates WHERE edital_id = :eid{extra} ORDER BY stage, gate_key"),
            params,
        ).fetchall()
    return [dict(r._mapping) for r in rows]


def set_gate(edital_id: str, stage: str, gate_key: str, concluido: bool, autor_email: str) -> Optional[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("""
                UPDATE edital_gates
                SET concluido = :c,
                    concluido_em = CASE WHEN :c THEN NOW() ELSE NULL END,
                    concluido_por = CASE WHEN :c THEN :ae ELSE NULL END
                WHERE edital_id = :eid AND stage = :stage AND gate_key = :key
                RETURNING *
            """),
            {"eid": edital_id, "stage": stage, "key": gate_key, "c": concluido, "ae": autor_email},
        ).fetchone()
        conn.commit()
    return dict(row._mapping) if row else None


# ── CRUD cache ───────────────────────────────────────────────────────────────

def get_cache(edital_id: str) -> Optional[dict]:
    """Retorna somatorio_json do cache ou None se não encontrado."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT somatorio_json FROM atestados_cache WHERE edital_id = :eid"),
                {"eid": edital_id},
            ).fetchone()
        if row is None:
            return None
        data = row[0]
        return data if isinstance(data, dict) else json.loads(data)
    except Exception as exc:
        log.warning("pg.get_cache_failed", extra={"edital_id": edital_id, "error": str(exc)})
        return None


def set_cache(edital_id: str, somatorio) -> None:
    """Upsert do somatório no cache.

    Args:
        edital_id: chave primária.
        somatorio: AtestadoSomatorio ou dict já serializado.
    """
    try:
        if hasattr(somatorio, "to_dict"):
            payload = json.dumps(somatorio.to_dict(), ensure_ascii=False, default=str)
        elif isinstance(somatorio, dict):
            payload = json.dumps(somatorio, ensure_ascii=False, default=str)
        else:
            payload = json.dumps(somatorio, ensure_ascii=False, default=str)

        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO atestados_cache
                        (edital_id, somatorio_json, drive_folder_id, pdfs_processados, pdfs_com_erro)
                    VALUES
                        (:eid, :payload::jsonb,
                         :folder_id, :pdfs_ok, :pdfs_err)
                    ON CONFLICT (edital_id) DO UPDATE SET
                        somatorio_json   = EXCLUDED.somatorio_json,
                        calculado_em     = NOW(),
                        drive_folder_id  = EXCLUDED.drive_folder_id,
                        pdfs_processados = EXCLUDED.pdfs_processados,
                        pdfs_com_erro    = EXCLUDED.pdfs_com_erro
                """),
                {
                    "eid": edital_id,
                    "payload": payload,
                    "folder_id": somatorio.to_dict().get("edital_id") if hasattr(somatorio, "to_dict") else None,
                    "pdfs_ok": getattr(somatorio, "pdfs_processados", 0),
                    "pdfs_err": getattr(somatorio, "pdfs_com_erro", 0),
                },
            )
            conn.commit()
        log.info("pg.set_cache_ok", extra={"edital_id": edital_id})
    except Exception as exc:
        log.warning("pg.set_cache_failed", extra={"edital_id": edital_id, "error": str(exc)})


def invalidate_cache(edital_id: str) -> bool:
    """Remove entrada do cache. Retorna True se algo foi deletado."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            result = conn.execute(
                text("DELETE FROM atestados_cache WHERE edital_id = :eid"),
                {"eid": edital_id},
            )
            conn.commit()
        deleted = (result.rowcount or 0) > 0
        log.info("pg.invalidate_cache", extra={"edital_id": edital_id, "deleted": deleted})
        return deleted
    except Exception as exc:
        log.warning("pg.invalidate_cache_failed", extra={"edital_id": edital_id, "error": str(exc)})
        return False


def invalidate_all_cache() -> int:
    """Remove TODAS as entradas do cache. Retorna número de linhas deletadas."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            result = conn.execute(text("DELETE FROM atestados_cache"))
            conn.commit()
        count = result.rowcount or 0
        log.info("pg.invalidate_all_cache", extra={"rows_deleted": count})
        return count
    except Exception as exc:
        log.warning("pg.invalidate_all_failed", extra={"error": str(exc)})
        return 0
