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


def ensure_schema() -> None:
    """Cria tabela `atestados_cache` se não existir (idempotente)."""
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text(_DDL_ATESTADOS_CACHE))
            conn.commit()
        log.info("pg.schema_ok")
    except Exception as exc:
        log.error("pg.ensure_schema_failed", extra={"error": str(exc)})
        raise


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
