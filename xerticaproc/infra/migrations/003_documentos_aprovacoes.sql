-- 003_documentos_aprovacoes.sql — xerticaproc Sprint C/D persistência
-- Migração aditiva: documentos gerados, aprovações humanas, eventos para bell.
-- Idempotente (IF NOT EXISTS).
-- Run: psql "$ALLOYDB_URL" -f 003_documentos_aprovacoes.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Documentos gerados (versão leve do redator) ──────────────────────────────
CREATE TABLE IF NOT EXISTS documentos_gerados (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id        UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  doc_type              TEXT NOT NULL CHECK (doc_type IN ('etp','tr','mapa_precos')),
  versao                INT  NOT NULL,
  content_md            TEXT NOT NULL,
  readiness_snapshot    JSONB NOT NULL,
  gerado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contratacao_id, doc_type, versao)
);
CREATE INDEX IF NOT EXISTS idx_documentos_contratacao
  ON documentos_gerados (contratacao_id, doc_type, versao DESC);

-- ── Aprovações humanas ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aprovacoes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id    UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  documento_id      UUID NOT NULL REFERENCES documentos_gerados(id) ON DELETE CASCADE,
  aprovado_por      TEXT NOT NULL,
  papel             TEXT NOT NULL,
  decisao           TEXT NOT NULL CHECK (decisao IN ('aprovado','rejeitado','retorno')),
  comentario        TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_doc      ON aprovacoes (documento_id);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_contrata ON aprovacoes (contratacao_id, criado_em DESC);

-- ── Eventos (notification bell + auditoria timeline) ─────────────────────────
CREATE TABLE IF NOT EXISTS eventos_contratacao (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  lido            BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eventos_contratacao ON eventos_contratacao (contratacao_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_lido        ON eventos_contratacao (lido, criado_em);

COMMIT;
