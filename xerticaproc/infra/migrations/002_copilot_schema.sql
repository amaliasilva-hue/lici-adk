-- 002_copilot_schema.sql — Copilot conversational layer for xerticaproc
-- Additive migration. Does NOT alter existing rows.
-- Run as: psql $DATABASE_URL -f 002_copilot_schema.sql
--
-- Tables:
--   conversas, mensagens, facts, decisoes_conversa, checklist_itens,
--   fontes_usuario, pesquisas_negativas, readiness_snapshots
-- Adds columns:
--   itens_preco.classificacao, itens_preco.origem, itens_preco.fonte_usuario_id
--   contratacoes.conversa_ativa_id

BEGIN;

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE checklist_status   AS ENUM ('pendente', 'inferido', 'confirmado', 'dispensado');
CREATE TYPE checklist_critic   AS ENUM ('bloqueante', 'alto', 'medio', 'baixo');
CREATE TYPE checklist_owner    AS ENUM ('usuario', 'orgao', 'sistema', 'juridico');
CREATE TYPE mensagem_role      AS ENUM ('user', 'assistant', 'system');
CREATE TYPE fonte_origem       AS ENUM ('usuario', 'sistema', 'documento', 'pesquisa');
CREATE TYPE classificacao_preco AS ENUM (
  'direta', 'indireta', 'parametrica', 'complementar', 'outlier', 'descartada'
);
CREATE TYPE fonte_usuario_tipo AS ENUM ('url', 'texto_colado', 'arquivo', 'print');
CREATE TYPE fonte_validacao    AS ENUM ('pendente', 'validada', 'descartada', 'outlier');

-- ── conversas ────────────────────────────────────────────────────────────────

CREATE TABLE conversas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  resumo          TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conversas_contratacao ON conversas (contratacao_id);

-- ── mensagens ────────────────────────────────────────────────────────────────

CREATE TABLE mensagens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversa_id     UUID NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  role            mensagem_role NOT NULL,
  conteudo        TEXT NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  anexos          JSONB NOT NULL DEFAULT '[]'::jsonb,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_mensagens_contratacao ON mensagens (contratacao_id, criado_em);
CREATE INDEX idx_mensagens_conversa    ON mensagens (conversa_id, criado_em);

-- ── facts (fatos extraídos) ──────────────────────────────────────────────────

CREATE TABLE facts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL,
  valor               JSONB NOT NULL,
  fonte_mensagem_id   UUID REFERENCES mensagens(id) ON DELETE SET NULL,
  confianca           REAL NOT NULL DEFAULT 1.0 CHECK (confianca BETWEEN 0 AND 1),
  confirmado          BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_facts_contratacao ON facts (contratacao_id, tipo);

-- ── decisoes_conversa ────────────────────────────────────────────────────────

CREATE TABLE decisoes_conversa (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL,
  valor               JSONB NOT NULL,
  justificativa       TEXT,
  fonte               fonte_origem NOT NULL,
  fonte_mensagem_id   UUID REFERENCES mensagens(id) ON DELETE SET NULL,
  confirmado_por      TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_decisoes_contratacao ON decisoes_conversa (contratacao_id, tipo);

-- ── checklist_itens ──────────────────────────────────────────────────────────

CREATE TABLE checklist_itens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  item_key        TEXT NOT NULL,
  categoria       TEXT NOT NULL,
  label           TEXT NOT NULL,
  status          checklist_status NOT NULL DEFAULT 'pendente',
  criticidade     checklist_critic NOT NULL,
  owner           checklist_owner  NOT NULL,
  valor           JSONB,
  evidence_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  justificativa   TEXT,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contratacao_id, item_key)
);
CREATE INDEX idx_checklist_contratacao  ON checklist_itens (contratacao_id, status);
CREATE INDEX idx_checklist_criticidade  ON checklist_itens (contratacao_id, criticidade);

-- ── fontes_usuario (price workbench input) ───────────────────────────────────

CREATE TABLE fontes_usuario (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  fonte_mensagem_id   UUID REFERENCES mensagens(id) ON DELETE SET NULL,
  tipo                fonte_usuario_tipo NOT NULL,
  url                 TEXT,
  texto_colado        TEXT,
  arquivo_gcs_uri     TEXT,
  produto             TEXT,
  valor_total         NUMERIC(18, 4),
  quantidade          NUMERIC(18, 4),
  vigencia_meses      INT,
  status_validacao    fonte_validacao NOT NULL DEFAULT 'pendente',
  classificacao       classificacao_preco,
  observacao          TEXT,
  item_preco_id       UUID REFERENCES itens_preco(id) ON DELETE SET NULL,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fontes_usuario_contratacao ON fontes_usuario (contratacao_id, status_validacao);

-- ── pesquisas_negativas ──────────────────────────────────────────────────────

CREATE TABLE pesquisas_negativas (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id          UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  termo                   TEXT NOT NULL,
  fontes_consultadas      JSONB NOT NULL,
  resultado               TEXT NOT NULL DEFAULT 'nao_localizado',
  justificativa           TEXT,
  efeito_na_estimativa    TEXT,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pesquisas_negativas_contratacao ON pesquisas_negativas (contratacao_id);

-- ── readiness_snapshots ──────────────────────────────────────────────────────

CREATE TABLE readiness_snapshots (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,
  can_generate        BOOLEAN NOT NULL,
  score               REAL NOT NULL,
  blocking_missing    JSONB NOT NULL,
  optional_missing    JSONB NOT NULL,
  inferred_items      JSONB NOT NULL,
  open_fields_orgao   JSONB NOT NULL,
  recommendations     TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_readiness_contratacao ON readiness_snapshots (contratacao_id, doc_type, criado_em);

-- ── adições em tabelas existentes ────────────────────────────────────────────

ALTER TABLE itens_preco
  ADD COLUMN classificacao    classificacao_preco,
  ADD COLUMN origem           TEXT NOT NULL DEFAULT 'pipeline',
  ADD COLUMN fonte_usuario_id UUID REFERENCES fontes_usuario(id) ON DELETE SET NULL;

ALTER TABLE contratacoes
  ADD COLUMN conversa_ativa_id UUID REFERENCES conversas(id) ON DELETE SET NULL;

COMMIT;
-- 002_copilot_schema.sql — xerticaproc Copilot (Sprint A)
-- Migração aditiva: adiciona conversa, mensagens, facts, decisões, checklist,
-- fontes do usuário, buscas negativas e snapshots de readiness.
-- Seguro de re-rodar (IF NOT EXISTS em tudo).
-- Run: psql "$ALLOYDB_URL" -f 002_copilot_schema.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Sessões de conversa ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  resumo          TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversas_contratacao ON conversas (contratacao_id);

-- ── Mensagens ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mensagens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversa_id     UUID NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  conteudo        TEXT NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  anexos          JSONB NOT NULL DEFAULT '[]'::jsonb,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mensagens_contratacao ON mensagens (contratacao_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_mensagens_conversa    ON mensagens (conversa_id, criado_em);

-- ── Fatos extraídos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL,
  valor               JSONB NOT NULL,
  fonte_mensagem_id   UUID REFERENCES mensagens(id) ON DELETE SET NULL,
  confianca           REAL NOT NULL DEFAULT 1.0,
  confirmado          BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facts_contratacao ON facts (contratacao_id, tipo);

-- ── Decisões registradas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decisoes_conversa (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL,
  valor               JSONB NOT NULL,
  justificativa       TEXT,
  fonte               TEXT NOT NULL CHECK (fonte IN ('usuario','sistema','documento','pesquisa')),
  fonte_mensagem_id   UUID REFERENCES mensagens(id) ON DELETE SET NULL,
  confirmado_por      TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_decisoes_contratacao ON decisoes_conversa (contratacao_id, tipo);

-- ── Checklist vivo ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_itens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  item_key        TEXT NOT NULL,
  categoria       TEXT NOT NULL,
  label           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pendente','inferido','confirmado','dispensado')),
  criticidade     TEXT NOT NULL CHECK (criticidade IN ('bloqueante','alto','medio','baixo')),
  owner           TEXT NOT NULL CHECK (owner IN ('usuario','orgao','sistema','juridico')),
  valor           JSONB,
  evidence_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  justificativa   TEXT,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contratacao_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_checklist_status      ON checklist_itens (contratacao_id, status);
CREATE INDEX IF NOT EXISTS idx_checklist_criticidade ON checklist_itens (contratacao_id, criticidade);

-- ── Fontes trazidas pelo usuário (Sprint B usa) ──────────────────────────────
CREATE TABLE IF NOT EXISTS fontes_usuario (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  fonte_mensagem_id   UUID REFERENCES mensagens(id) ON DELETE SET NULL,
  tipo                TEXT NOT NULL CHECK (tipo IN ('url','texto_colado','arquivo','print')),
  url                 TEXT,
  texto_colado        TEXT,
  arquivo_gcs_uri     TEXT,
  produto             TEXT,
  valor_total         NUMERIC(18,4),
  quantidade          NUMERIC(18,4),
  vigencia_meses      INT,
  status_validacao    TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status_validacao IN ('pendente','validada','descartada','outlier')),
  classificacao       TEXT,
  observacao          TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fontes_usuario_ctc ON fontes_usuario (contratacao_id, status_validacao);

-- ── Buscas negativas ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pesquisas_negativas (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id          UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  termo                   TEXT NOT NULL,
  fontes_consultadas      JSONB NOT NULL,
  resultado               TEXT NOT NULL DEFAULT 'nao_localizado',
  justificativa           TEXT,
  efeito_na_estimativa    TEXT,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pesq_neg_ctc ON pesquisas_negativas (contratacao_id);

-- ── Readiness snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS readiness_snapshots (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,
  can_generate        BOOLEAN NOT NULL,
  score               REAL NOT NULL,
  blocking_missing    JSONB NOT NULL,
  optional_missing    JSONB NOT NULL,
  inferred_items      JSONB NOT NULL,
  open_fields_orgao   JSONB NOT NULL,
  recommendations     TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_readiness_ctc ON readiness_snapshots (contratacao_id, doc_type, criado_em);

-- ── Atalho na contratação ────────────────────────────────────────────────────
ALTER TABLE contratacoes
  ADD COLUMN IF NOT EXISTS conversa_ativa_id UUID REFERENCES conversas(id) ON DELETE SET NULL;

COMMIT;
