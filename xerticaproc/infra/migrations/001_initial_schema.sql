-- 001_initial_schema.sql — xerticaproc AlloyDB schema
-- Requires: pgvector extension (enabled via AlloyDB DB flag)
-- Run as: psql $DATABASE_URL -f 001_initial_schema.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgvector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE status_contratacao AS ENUM (
  'rascunho',
  'em_analise',
  'pesquisa_mercado',
  'pesquisa_precos',
  'revisao',
  'aprovado',
  'cancelado'
);

CREATE TYPE tipo_documento AS ENUM ('ETP', 'TR', 'DFD', 'PCA');

CREATE TYPE natureza_objeto AS ENUM ('servico', 'bem', 'obra', 'solucao_ti');

CREATE TYPE tipo_fonte_mercado AS ENUM (
  'arp_ata',
  'contrato_vigente',
  'painel_precos',
  'pncp_ata',
  'compras_gov',
  'cotacao_fornecedor',
  'pesquisa_internet',
  'outro'
);

-- ── contratacoes ─────────────────────────────────────────────────────────────

CREATE TABLE contratacoes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status                status_contratacao NOT NULL DEFAULT 'rascunho',
  id_orgao              TEXT NOT NULL,
  nome_orgao            TEXT NOT NULL,
  uasg                  TEXT,
  objeto_resumido       TEXT NOT NULL,
  descricao_necessidade TEXT NOT NULL,
  natureza_objeto       natureza_objeto,
  valor_estimado_maximo NUMERIC(18, 2),
  prazo_vigencia_meses  INT,
  palavras_chave        TEXT[] NOT NULL DEFAULT '{}',
  dfd_texto             TEXT,
  data_necessidade      DATE,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- denormalized output snapshots (for quick reads)
  bundle_json           JSONB,
  mapa_precos_json      JSONB,
  etp_json              JSONB,
  tr_json               JSONB
);

CREATE INDEX idx_contratacoes_status     ON contratacoes (status);
CREATE INDEX idx_contratacoes_criado_em  ON contratacoes (criado_em DESC);
CREATE INDEX idx_contratacoes_id_orgao   ON contratacoes (id_orgao);

-- ── jobs ─────────────────────────────────────────────────────────────────────

CREATE TABLE jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  etapa           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','done','failed')),
  progresso       INT NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  erro            TEXT,
  resultado       JSONB,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em    TIMESTAMPTZ
);

CREATE INDEX idx_jobs_contratacao ON jobs (contratacao_id, criado_em DESC);
CREATE INDEX idx_jobs_status      ON jobs (status) WHERE status IN ('pending','running');

-- ── itens_preco ───────────────────────────────────────────────────────────────
-- Individual price evidence rows — one per source citation.

CREATE TABLE itens_preco (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id         UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  fonte                  TEXT NOT NULL,
  tipo_fonte             tipo_fonte_mercado NOT NULL,
  descricao_licitada     TEXT NOT NULL,
  valor_unitario         NUMERIC(18, 4) NOT NULL,
  unidade                TEXT NOT NULL,
  quantidade             NUMERIC(18, 4),
  vigencia_meses         INT,
  data_referencia        DATE,
  orgao_comprador        TEXT,
  numero_processo        TEXT,
  url_evidencia          TEXT,
  score_comparabilidade  NUMERIC(4, 3) NOT NULL DEFAULT 0.0
                           CHECK (score_comparabilidade BETWEEN 0 AND 1),
  flags_qualidade        TEXT[] NOT NULL DEFAULT '{}',
  valido                 BOOLEAN NOT NULL DEFAULT TRUE,
  coletado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- optional embedding for semantic dedup
  embedding              vector(768)
);

CREATE INDEX idx_itens_preco_contratacao   ON itens_preco (contratacao_id);
CREATE INDEX idx_itens_preco_score         ON itens_preco (contratacao_id, score_comparabilidade DESC)
                                           WHERE valido = TRUE;
CREATE INDEX idx_itens_preco_data          ON itens_preco (data_referencia DESC);

-- ── documentos ───────────────────────────────────────────────────────────────

CREATE TABLE documentos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id    UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo_documento    tipo_documento NOT NULL,
  versao            INT NOT NULL DEFAULT 1,
  conteudo_markdown TEXT NOT NULL,
  pendencias        TEXT[] NOT NULL DEFAULT '{}',
  tokens_usados     INT,
  gerado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revisado_em       TIMESTAMPTZ,
  score_qualidade   NUMERIC(4, 3),
  aprovado          BOOLEAN
);

CREATE INDEX idx_documentos_contratacao ON documentos (contratacao_id, tipo_documento, versao DESC);

-- ── audit_log ────────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  contratacao_id  UUID REFERENCES contratacoes(id) ON DELETE SET NULL,
  acao            TEXT NOT NULL,
  detalhes        JSONB,
  usuario         TEXT,
  ip_address      INET,
  ocorrido_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_contratacao ON audit_log (contratacao_id, ocorrido_em DESC);
CREATE INDEX idx_audit_ocorrido    ON audit_log (ocorrido_em DESC);

-- ── trigger: atualizado_em ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contratacoes_atualizado
  BEFORE UPDATE ON contratacoes
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

COMMIT;
