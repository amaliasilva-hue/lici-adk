# 03 — Data Model v2 (Copilot Schema)

Migration **aditiva**: `infra/migrations/002_copilot_schema.sql`. Não altera tabelas existentes.

## Novas tabelas

```sql
-- Sessões de conversa por contratação
CREATE TABLE conversas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  resumo          TEXT,                         -- summary acumulado a cada 16 turnos
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON conversas (contratacao_id);

-- Mensagens (display + auditoria)
CREATE TABLE mensagens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversa_id     UUID NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id),
  role            TEXT NOT NULL,                -- 'user' | 'assistant' | 'system'
  conteudo        TEXT NOT NULL,
  meta            JSONB DEFAULT '{}'::jsonb,    -- next_best_question, suggested_action...
  anexos          JSONB DEFAULT '[]'::jsonb,    -- [{tipo, nome, gcs_uri}]
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON mensagens (contratacao_id, criado_em);
CREATE INDEX ON mensagens (conversa_id, criado_em);

-- Fatos extraídos (estado estruturado fino)
CREATE TABLE facts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL,            -- 'modalidade'|'prazo_meses'|'lote'|'restricao'...
  valor               JSONB NOT NULL,
  fonte_mensagem_id   UUID REFERENCES mensagens(id),
  confianca           FLOAT DEFAULT 1.0,
  confirmado          BOOLEAN DEFAULT FALSE,    -- true só após confirmação explícita
  criado_em           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON facts (contratacao_id, tipo);

-- Decisões registradas pela conversa
CREATE TABLE decisoes_conversa (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id        UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  tipo                  TEXT NOT NULL,
  valor                 JSONB NOT NULL,
  justificativa         TEXT,
  fonte                 TEXT NOT NULL,          -- 'usuario'|'sistema'|'documento'|'pesquisa'
  fonte_mensagem_id     UUID REFERENCES mensagens(id),
  confirmado_por        TEXT,
  criado_em             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON decisoes_conversa (contratacao_id, tipo);

-- Checklist vivo (Lei 14.133 + IN 94)
CREATE TABLE checklist_itens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  item_key        TEXT NOT NULL,                -- ex: 'escopo.modalidade' (ver doc 05)
  categoria       TEXT NOT NULL,                -- demanda|escopo|quantitativos|precos|juridico|tecnico|lgpd|gestao|documentos
  label           TEXT NOT NULL,
  status          TEXT NOT NULL,                -- pendente|inferido|confirmado|dispensado
  criticidade     TEXT NOT NULL,                -- bloqueante|alto|medio|baixo
  owner           TEXT NOT NULL,                -- usuario|orgao|sistema|juridico
  valor           JSONB,
  evidence_ids    JSONB DEFAULT '[]'::jsonb,    -- referências a facts/decisoes/fontes
  atualizado_em   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (contratacao_id, item_key)
);
CREATE INDEX ON checklist_itens (contratacao_id, status);
CREATE INDEX ON checklist_itens (contratacao_id, criticidade);

-- Fontes trazidas pelo usuário durante a conversa
CREATE TABLE fontes_usuario (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  fonte_mensagem_id   UUID REFERENCES mensagens(id),
  tipo                TEXT NOT NULL,            -- url|texto_colado|arquivo|print
  url                 TEXT,
  texto_colado        TEXT,
  arquivo_gcs_uri     TEXT,
  produto             TEXT,
  valor_total         FLOAT,
  quantidade          FLOAT,
  vigencia_meses      INT,
  status_validacao    TEXT NOT NULL DEFAULT 'pendente',  -- pendente|validada|descartada|outlier
  classificacao       TEXT,                     -- direta|indireta|parametrica|complementar|outlier|descartada
  observacao          TEXT,
  item_mercado_id     UUID REFERENCES itens_mercado(id),  -- após normalização
  criado_em           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON fontes_usuario (contratacao_id, status_validacao);

-- Buscas negativas (evidência de que NÃO foi encontrado)
CREATE TABLE pesquisas_negativas (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id          UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  termo                   TEXT NOT NULL,
  fontes_consultadas      JSONB NOT NULL,       -- ['PNCP','Compras.gov','Painel de Preços']
  resultado               TEXT NOT NULL DEFAULT 'nao_localizado',
  justificativa           TEXT,
  efeito_na_estimativa    TEXT,
  criado_em               TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON pesquisas_negativas (contratacao_id);

-- Snapshots de readiness por geração tentada
CREATE TABLE readiness_snapshots (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contratacao_id      UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,            -- etp|tr|mapa_precos
  can_generate        BOOLEAN NOT NULL,
  score               FLOAT NOT NULL,
  blocking_missing    JSONB NOT NULL,
  optional_missing    JSONB NOT NULL,
  inferred_items      JSONB NOT NULL,
  open_fields_orgao   JSONB NOT NULL,
  recommendations     TEXT,
  criado_em           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON readiness_snapshots (contratacao_id, doc_type, criado_em);
```

## Adições em tabelas existentes

```sql
-- Para classificar item de mercado conforme metodologia
ALTER TABLE itens_mercado
  ADD COLUMN classificacao TEXT,                -- direta|indireta|parametrica|complementar|outlier|descartada
  ADD COLUMN origem TEXT NOT NULL DEFAULT 'pipeline',  -- pipeline|usuario_chat
  ADD COLUMN fonte_usuario_id UUID REFERENCES fontes_usuario(id);

-- Adiciona um id de conversa ativa na contratação (atalho)
ALTER TABLE contratacoes
  ADD COLUMN conversa_ativa_id UUID REFERENCES conversas(id);
```

## Visão consolidada (mapa de relações)

```
contratacoes ─┬─ conversas ─── mensagens
              ├─ facts (←─ mensagens.fonte)
              ├─ decisoes_conversa
              ├─ checklist_itens (item_key UNIQUE)
              ├─ fontes_usuario ──→ itens_mercado (após normalização)
              ├─ pesquisas_negativas
              ├─ readiness_snapshots
              ├─ documentos_gerados (já existia)
              └─ evidence_bundles (já existia)
```

## Regras de integridade

- `mensagens.conversa_id` e `mensagens.contratacao_id` devem pertencer à mesma contratação (validar em código)
- `checklist_itens.item_key` é o id canônico do checklist (ver [05](./05_CHECKLIST_ENGINE.md)); seed populado na criação da contratação
- `facts.confirmado=TRUE` só pode ser setado por turno explícito do usuário ou por aprovação humana
- Soft delete: nenhuma. Auditoria depende de tudo persistido.

## Migration script

```bash
psql "$ALLOYDB_URL" -f xerticaproc/infra/migrations/002_copilot_schema.sql
```
