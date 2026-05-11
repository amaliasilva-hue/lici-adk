-- 004_documentos_biblioteca.sql — biblioteca unificada de documentos do copiloto
-- Aditiva. Idempotente.
-- Run: psql "$ALLOYDB_URL" -f 004_documentos_biblioteca.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE documento_origem AS ENUM (
    'upload_chat', 'gerado', 'fonte_externa', 'drive_sync', 'pesquisa_negativa'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE documento_status AS ENUM (
    'processando', 'pronto', 'falhou', 'arquivado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── documentos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documentos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  bytes_size      BIGINT NOT NULL DEFAULT 0,
  pages           INT,
  sha256          CHAR(64) NOT NULL,
  origem          documento_origem NOT NULL,
  origem_ref      JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_uri     TEXT NOT NULL,
  thumb_uri       TEXT,
  preview_uri     TEXT,
  text_excerpt    TEXT,
  status          documento_status NOT NULL DEFAULT 'processando',
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by     TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_documentos_cid_sha
  ON documentos (contratacao_id, sha256);
CREATE INDEX IF NOT EXISTS ix_documentos_cid_origem
  ON documentos (contratacao_id, origem, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_documentos_cid_status
  ON documentos (contratacao_id, status);

-- ── chunks (RAG — populado em sprint posterior) ──────────────────────────────
CREATE TABLE IF NOT EXISTS documento_chunks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  documento_id    UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  contratacao_id  UUID NOT NULL,
  chunk_idx       INT NOT NULL,
  page            INT,
  text            TEXT NOT NULL,
  embedding       vector(768),
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_chunks_doc
  ON documento_chunks (documento_id, chunk_idx);
CREATE INDEX IF NOT EXISTS ix_chunks_cid
  ON documento_chunks (contratacao_id);

-- ── refs N×M mensagem↔documento ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensagem_documento_refs (
  mensagem_id     UUID NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
  documento_id    UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  papel           TEXT NOT NULL,
  trechos         JSONB NOT NULL DEFAULT '[]'::jsonb,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mensagem_id, documento_id, papel)
);
CREATE INDEX IF NOT EXISTS ix_msgdocref_doc
  ON mensagem_documento_refs (documento_id);

COMMIT;
