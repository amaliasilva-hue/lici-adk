# 11 — Biblioteca de Documentos do Copiloto

> **Objetivo**: tornar todo arquivo enviado/usado no chat (PDF, DOCX, XLSX, imagem, link)
> uma **fonte de conhecimento persistente, visualizável e referenciável** dentro da
> contratação. Hoje os anexos só existem dentro da mensagem que os carregou e
> são re-extraídos toda vez que o usuário pergunta sobre eles. Vamos transformá-los
> em **first-class citizens** do projeto.

---

## 1. Diagnóstico da implementação atual

### 1.1 Fluxo hoje
1. Usuário arrasta `.docx` no chat → `POST /uploads` faz upload pra GCS
   (`gs://operaciones-br-xerticaproc-docs/copilot/{cid}/{uuid}-nome.ext`).
2. O endpoint devolve um `Anexo { tipo, nome, gcs_uri }` que vive **só no estado
   local do React** (`pendingAnexos`).
3. Ao mandar a mensagem, o array `anexos` é serializado como JSONB na coluna
   `mensagens.anexos`.
4. O `document_extractor` baixa do GCS, extrai texto, gera `Parts` multimodais e
   injeta no prompt **uma única vez**. Nada é indexado.
5. Próxima pergunta → o LLM **não tem mais o conteúdo do arquivo**, a menos que
   o usuário re-anexe ou que o trecho específico tenha caído no resumo.

### 1.2 Limitações
- ❌ Não há listagem dos arquivos enviados na contratação.
- ❌ Não há viewer (PDF/DOCX preview) na UI.
- ❌ Não há reuso: o mesmo TR enviado 3× é re-extraído 3×.
- ❌ Não há referência citável (`[doc:nome p.4]`) nas respostas do agente.
- ❌ Anexo enviado na mensagem N não é "fonte" pra mensagem N+1 (a menos que
  tenha virado fato no checklist).
- ❌ Sem deduplicação por hash → mesmo arquivo ocupa GCS várias vezes.
- ❌ Sem busca semântica nos documentos da contratação.

---

## 2. Visão alvo

> **"Toda contratação tem uma biblioteca. Tudo que entra ali — por upload,
> link, geração de documento, PNCP, ou pesquisa — vira um item indexado,
> visualizável, citável e reutilizável."**

### 2.1 Conceito unificado: `Documento`
Um único modelo cobre:
- Anexos enviados pelo usuário no chat (`origem=upload_chat`)
- Documentos gerados pelo Copiloto (TR, ETP, mapa de preços, mapa de risco — `origem=gerado`)
- PDFs/links capturados de fontes externas (PNCP, Painel de Preços — `origem=fonte_externa`)
- Atestados de capacidade técnica colados via Drive (`origem=drive_sync`)

Todos compartilham a mesma UX de visualização e referência.

---

## 3. Modelo de dados

### 3.1 Tabela `documentos` (nova)
```sql
CREATE TABLE documentos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  mime            TEXT NOT NULL,
  bytes_size      BIGINT NOT NULL DEFAULT 0,
  pages           INT,
  sha256          CHAR(64) NOT NULL,                  -- dedup
  origem          documento_origem NOT NULL,           -- enum
  origem_ref      JSONB DEFAULT '{}'::jsonb,           -- {message_id, doc_type, url, ...}
  storage_uri     TEXT NOT NULL,                       -- gs://...
  thumb_uri       TEXT,                                -- gs://... preview PNG (1ª pág)
  preview_uri     TEXT,                                -- gs://... PDF normalizado
  text_excerpt    TEXT,                                -- primeiros ~3KB extraídos
  status          documento_status NOT NULL DEFAULT 'processando',
  meta            JSONB DEFAULT '{}'::jsonb,           -- {autor, data_doc, classificacao, tags}
  uploaded_by     TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em   TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_documentos_cid_sha ON documentos (contratacao_id, sha256);
CREATE INDEX ix_documentos_cid_origem ON documentos (contratacao_id, origem);

CREATE TYPE documento_origem AS ENUM (
  'upload_chat', 'gerado', 'fonte_externa', 'drive_sync', 'pesquisa_negativa'
);
CREATE TYPE documento_status AS ENUM (
  'processando', 'pronto', 'falhou', 'arquivado'
);
```

### 3.2 Tabela `documento_chunks` (RAG)
```sql
CREATE TABLE documento_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id    UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  contratacao_id  UUID NOT NULL,                       -- denormalizado p/ filtro rápido
  chunk_idx       INT NOT NULL,
  page            INT,
  text            TEXT NOT NULL,
  embedding       VECTOR(768),                          -- text-embedding-004
  meta            JSONB DEFAULT '{}'::jsonb,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_chunks_doc ON documento_chunks (documento_id, chunk_idx);
CREATE INDEX ix_chunks_cid_emb ON documento_chunks
  USING hnsw (embedding vector_cosine_ops);
```

### 3.3 Tabela `mensagem_documento_refs` (linkagem N↔M)
Substitui o `mensagens.anexos JSONB` (que vira somente cache).
```sql
CREATE TABLE mensagem_documento_refs (
  mensagem_id     UUID NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
  documento_id    UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  papel           TEXT NOT NULL,         -- 'anexado_pelo_usuario' | 'citado_pelo_agente'
  trechos         JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY (mensagem_id, documento_id, papel)
);
```

### 3.4 Migração
- `infra/migrations/00X_documentos.sql` cria as 3 tabelas + enums.
- Backfill: lê `mensagens.anexos`, deduplica por `gcs_uri` e cria
  registros em `documentos` + `mensagem_documento_refs`.

---

## 4. APIs (FastAPI)

Todas sob o prefixo já existente
`/proc/contratacoes/{cid}/documentos`.

| Método | Path                                      | Descrição |
|-------:|-------------------------------------------|-----------|
| GET    | `/documentos`                             | Lista (filtros: `origem`, `status`, `q`, `tag`, `page`) |
| POST   | `/documentos/upload`                      | Multipart; substitui `/uploads` retornando `Documento` completo |
| GET    | `/documentos/{doc_id}`                    | Metadados + presigned URL (preview/original) |
| GET    | `/documentos/{doc_id}/conteudo`           | Stream binário (proxied; auth obrigatória) |
| GET    | `/documentos/{doc_id}/thumb`              | PNG da 1ª pág (cache 7d) |
| GET    | `/documentos/{doc_id}/texto`              | Texto extraído paginado |
| POST   | `/documentos/{doc_id}/reindex`            | Força reextract + reembed |
| PATCH  | `/documentos/{doc_id}`                    | Editar nome/tags/classificação |
| DELETE | `/documentos/{doc_id}`                    | Soft delete (status=arquivado) |
| POST   | `/documentos/buscar`                      | RAG semântico + lexical (top_k, filtros) |
| POST   | `/documentos/citar`                       | Resolve `[doc:nome p.4]` → `{doc_id, page, trecho}` |

**Compatibilidade**: `/uploads` continua existindo, redireciona internamente
para `/documentos/upload` (mesma resposta + `documento_id`).

---

## 5. Pipeline de processamento

Job assíncrono (FastAPI BackgroundTask + tabela `jobs`):
1. **upload** → grava `documentos` com `status=processando`, calcula `sha256`
   (se já existe, retorna o existente — **dedup**).
2. **normalize** → DOCX/XLSX → PDF via LibreOffice headless (já no container);
   imagem → mantém; PDF → roda `qpdf --linearize`.
3. **thumb** → primeira página → PNG 800×… via PyMuPDF.
4. **extract** → reusa `document_extractor.py`; salva `text_excerpt` e
   chunks (1k tokens, overlap 150).
5. **embed** → `text-embedding-004` em batch de 100 chunks.
6. **classify** (opcional, Gemini Flash) → detecta tipo (TR, atestado, ETP,
   nota fiscal, ofício, planilha de preço) e popula `meta.classificacao` +
   sugere tags.
7. **status=pronto** → emite SSE `documento_pronto` para a UI.

---

## 6. Integração com o Copiloto (orchestrator)

### 6.1 Contexto do prompt
A cada turno, antes de chamar o LLM:
1. Sempre injeta `lista_de_documentos` (id, nome, classificação, tags, 1 linha
   de resumo) — barato, ~50 tokens por doc.
2. Se a mensagem do usuário tem anexos novos OU menciona um doc existente,
   roda RAG (`POST /documentos/buscar`) e injeta os top-k chunks.
3. O `system_prompt` ganha:
   ```
   Quando referenciar um documento, use o formato [doc:NOME p.PÁGINA].
   O frontend transforma em link clicável que abre o viewer no trecho.
   ```

### 6.2 Citações estruturadas
- O `ConversationTurnAnalysis` ganha campo
  `citations: list[{doc_id, page, quote}]`.
- O orchestrator persiste em `mensagem_documento_refs` com `papel='citado_pelo_agente'`.

### 6.3 Atestados (caso especial já existente)
O agente de análise comercial passa a usar a mesma biblioteca:
ao detectar atestados sincronizados do Drive, eles entram como
`documentos(origem='drive_sync')` e ficam listados/visualizáveis junto.

---

## 7. UX / Frontend

### 7.1 Painel direito ganha aba "Biblioteca"
Hoje o painel direito tem (Fontes, Pesquisas Negativas, Pacote, Revisor).
Acrescentar:

```
[ Fontes ] [ Negativas ] [ Biblioteca ] [ Documentos Gerados ] [ Pacote ]
```

A aba **Biblioteca** mostra um grid 2-col com cards:
```
┌─────────────────────────────┐
│ [thumb]  TR_DESO_v4.docx    │
│          27 pág · TR · 2.1MB│
│          ⓘ classificado: TR │
│          [👁 ver] [@ citar] │
└─────────────────────────────┘
```

### 7.2 Drag & drop em qualquer lugar do chat
Hoje só pelo paperclip. Adicionar overlay visual quando o usuário arrasta
arquivos sobre a área central.

### 7.3 Chip de anexo na bolha (já existe — melhorar)
- Mostra thumb 40×40
- Clicar abre **viewer modal** (não download)
- Hover mostra "Adicionado em … por …"

### 7.4 Viewer modal (`<DocumentViewer>`)
- PDF: `react-pdf` com paginação + busca interna
- Imagem: lightbox simples
- DOCX/XLSX: usa o **PDF normalizado** (`preview_uri`) gerado no pipeline
- Header tem: nome, classificação, tags editáveis, botões
  `[Inserir no chat como contexto]` / `[Usar como fonte]` / `[Baixar original]`

### 7.5 Citações renderizadas no chat
A bolha do agente parseia `[doc:NOME p.4]` e vira pill clicável:
```
… conforme item 5.2 do  📎 TR_DESO_v4 · p.12  …
```
Click abre o viewer já na página 12 com highlight do `quote`.

### 7.6 Comando `@` no input
Digitar `@` abre menu com documentos da biblioteca (igual menção do Slack).
Selecionar insere `@TR_DESO_v4` no input → backend resolve pra anexo
implícito (sem reupload).

### 7.7 Listagem na home da contratação
A página `/contratacoes/[id]` (não a do copiloto) ganha card
"Biblioteca (12 documentos)" com últimos 4 e link para a aba.

---

## 8. Features sugeridas (priorizadas)

### MVP (Sprint 1 — 1 semana)
- [ ] Migração DB (`documentos`, `documento_chunks`, `mensagem_documento_refs`)
- [ ] Endpoint `GET /documentos` + `POST /documentos/upload` com dedup por hash
- [ ] Pipeline básico: extract + embed + thumb (sem normalize DOCX→PDF ainda)
- [ ] Aba "Biblioteca" no painel direito (lista + delete)
- [ ] Viewer básico para PDF e imagem (`react-pdf`)
- [ ] Backfill dos `mensagens.anexos` existentes

### V1 (Sprint 2)
- [ ] RAG no orchestrator (top-k injetado quando relevante)
- [ ] Citações `[doc:nome p.X]` parseadas e clicáveis
- [ ] Comando `@` no input
- [ ] Drag-and-drop overlay
- [ ] Normalize DOCX/XLSX → PDF (LibreOffice headless)

### V2 (Sprint 3+)
- [ ] Classificação automática (Gemini Flash) — TR, ETP, atestado, NF, etc.
- [ ] Tags manuais + filtros
- [ ] **Comparador**: selecionar 2 docs → diff lado-a-lado (útil pra TR antigo
      vs nova versão)
- [ ] **Highlights persistentes**: usuário marca trecho importante → vira fato
      no checklist com `trecho_literal`
- [ ] **Document chat**: clicar em "Conversar com este documento" abre side-chat
      escopado a 1 doc
- [ ] **Versionamento**: substituir TR_v3 por TR_v4 mantém histórico
- [ ] **OCR pesado**: PDF imagem-heavy passa por Document AI quando PyMuPDF +
      Gemini falham
- [ ] **Resumo automático** com botão "Gerar TL;DR" por doc
- [ ] **Exportar pacote**: ZIP com todos os docs da biblioteca + manifest CSV
- [ ] **Compartilhamento**: gerar link público (assinado, expira) de um doc
      específico para terceiros
- [ ] **Notificações**: "novo documento adicionado por @fulano"
- [ ] **Análise de risco**: agente jurídico marca trechos suspeitos
      (cláusula restritiva, exigência desproporcional) e linka no checklist

---

## 9. Considerações técnicas

### 9.1 Storage
- Bucket único `operaciones-br-xerticaproc-docs` (já existe)
- Layout: `gs://.../copilot/{cid}/{doc_id}/original.{ext}`,
  `.../{doc_id}/preview.pdf`, `.../{doc_id}/thumb.png`
- Lifecycle rule: arquivar `arquivado` após 90d

### 9.2 Segurança
- Toda URL servida é **presigned com TTL 15min**, nunca pública
- Proxy Next.js valida `contratacao_id` ↔ usuário antes de retornar binário
- Tamanho máximo por upload: já em 40MB (`COPILOT_MAX_UPLOAD_BYTES`)
- Vírus scan: opcional (ClamAV em job assíncrono) na V2

### 9.3 Custos
- Embedding: ~0.02$/1M tokens com `text-embedding-004` → desprezível
- Storage: ~0.02$/GB/mês
- Vertex multimodal: só na **primeira extração**; depois usa chunks indexados

### 9.4 Performance
- Upload retorna em <2s mesmo pro doc grande (job processa em background)
- UI mostra spinner "processando" até `status=pronto` (SSE)
- RAG por contratação: tipicamente <50 docs → busca em <100ms

### 9.5 Compatibilidade com `mensagens.anexos`
Não removemos a coluna. Ela vira **cache leve** (id+nome+thumb_uri) pro
`ChatHistoryResponse` não precisar de JOIN extra. A fonte de verdade passa a
ser `mensagem_documento_refs`.

---

## 10. Critérios de aceite (V1)
1. Upload de `.docx` aparece em <2s na aba Biblioteca, processa em <30s.
2. Clicar no anexo da bolha abre o viewer com PDF renderizado.
3. Usuário pergunta "Qual o objeto do TR?" → resposta cita
   `[doc:TR_DESO_v4 p.1]`, clicar abre viewer na p.1.
4. Re-upload do mesmo arquivo é detectado por hash, não duplica no GCS.
5. Excluir documento remove referências mas preserva mensagens (mostra
   "📎 documento removido" no lugar do chip).
6. Histórico anterior à migração continua funcionando (backfill).

---

## 11. Open questions
- [ ] Compartilhamento entre contratações da mesma área? (ex.: o mesmo
      modelo de TR servir várias contratações). Sugestão: tabela
      `documento_compartilhado_org` numa V2.
- [ ] Suporte a links externos do Drive como `Documento` (sem download)?
      Hoje cobrimos só PDF/DOCX baixado. Na V2 vale embutir iframe do Drive.
- [ ] Permissões granulares por documento (privado / equipe / público
      organização)?
- [ ] Limites do `react-pdf` em arquivos >100 páginas — usar `pdf.js` worker
      separado.
