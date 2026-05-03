# Plano de Revamp — `lici-adk` (Maio 2026)

Documento único de planejamento. Nada vai ao código antes de revisão e aprovação.

---

## STATUS DE IMPLEMENTAÇÃO (atualizado 03 Mai 2026)

### ✅ CONCLUÍDO

| Item | Descrição |
|---|---|
| A0 | Persistência `analysis_jobs` em Postgres + sha256 dedup (`find_job_by_sha256`) |
| A2 | `POST /analyze/from-drive` — ingestão de um arquivo Drive |
| A3 | `POST /analyze/from-drive-folder` — ingestão em massa de pasta Drive |
| A4 | `GET /analyze/by-ids` — polling em batch via Postgres |
| §25 | `POST /analyze/from-url` — importação de URL pública (PNCP, Comprasnet…) |
| B1 | CSS tokens: `.heading-xl`, `.skeleton`, `.dropzone`, `.nav-active`, `.tabs-pill`, orbs, grid, btn-primary gradient |
| B2 | `layout.tsx` — header h-16, nav `Pipeline · Histórico · Chat IA · Como funciona`, avatar white X, backdrop blur |
| C1 | `@dnd-kit` kanban com `DragOverlay` (rotate+glow), `data-drop-target` em colunas |
| D1 | Hero Pipeline com `text-4xl font-poppins`, subtítulo counts (ativos/APTO/aguardando) |
| D4 | Drag-and-drop entre colunas com optimistic update + rollback |
| D1 | Busca inline (searchbar colapsável), filter chips (UF, P1-P3) |
| D (bulk) | `BulkActionBar` com "Mais ações": atribuir vendedor, prioridade, mover fase → `POST /editais/bulk_update` |
| E1 | `/upload` — 4 abas: PDF / Google Drive / Pasta do Drive / URL pública + SA callout com botão copy |
| E2 | `/historico` — skeletons, exportar CSV (BOM-prefixed), filtros com chip "Limpar" |
| E3 | `/como-funciona` — pipeline visual 4 agentes, fontes de dados, CTA |
| §22 | Score breakdown v2: barra gradiente, máximo alcançável, limiares 45%/70%, CTA "Ver gaps de habilitação" |
| §23 | Dedup upload (sha256): `POST /analyze` retorna `status: already_exists` com `analysis_id` existente |
| §24 | Gates checklist UI no `/edital/[id]` aba Resumo: progress bar + checkboxes clicáveis via `PATCH /editais/{id}/gates/{key}` |
| §27 | Timeline de movimentações em `/edital/[id]` (Accordion "Histórico de movimentações") |
| §28 | Bloco "Histórico com este órgão" no `/edital/[id]` + bug fix (`participacoes/score_medio`) |
| §31 | Bulk edit: `BulkActionBar` + `POST /editais/bulk_update` (vendedor, prioridade, fase) |
| §33 | `/status` — health dashboard (API, Postgres, BigQuery, Vertex, Drive), auto-refresh 30s |
| §21 | Chat SSE streaming: `POST /chat/sessions/{id}/messages/stream` + proxy pipe + frontend `ReadableStream` |
| `_notify_comment` | Webhook Apps Script em background task ao criar comentário |
| `GET /editais/{id}/historico-orgao` | Retorna participações anteriores com o mesmo órgão |
| E4 | Banner WIP em `/config` (fundo laranja, ícone 🔒) |
| §30 | Notificações in-app: tabela `notifications` no Postgres, `GET /notifications`, `POST /notifications/read`, `NotificationBell` no header (sino com badge, dropdown, auto-poll 30s) |
| §29 | CI/CD GitHub Actions: `ci.yml` (backend pytest + frontend build + Docker) e `deploy.yml` (gcloud run deploy backend então frontend + Slack notify) |

### 🔴 PENDENTE (próximas implementações)

| Item | Descrição | Prioridade |
|---|---|---|
| §34 | `POST /webhooks/ingest` — entrada via n8n/Zapier | Média |
| §35 | Notas rápidas inline no card kanban (popover comentário rápido) | Média |
| §12.1 | Comparador de editais side-by-side | Baixa |
| §12.2 | Similaridade automática com pgvector | Baixa |
| §12.3 | Smart rank (score dinâmico por prazo/valor/histórico) | Baixa |
| §12.5 | Geração de proposta técnica draft | Baixa |
| §13.1 | Command palette ⌘K | Baixa |
| §15.2 | React Query (TanStack Query) | Baixa |
| §16 | Testes Playwright + pytest | Baixa |

---

## 0. Princípios de design

1. **Brandbook é lei.** Usar tokens (`--x-cyan`, `--x-pink`, `--font-poppins`, `bg-grid`, `bg-orbs`, GlowCards, fade-up) já carregados em `globals.css`. Tipografia generosa (heading 4xl/5xl), respiro alto, animação sutil, sem bordas duras.
2. **Pipeline-centric.** Tudo que o vendedor faz no dia-a-dia mora no Kanban. Páginas separadas existem só para tarefas longas (Histórico, Chat, detalhe).
3. **Ingestão sem fricção.** Em **um clique** ou **um drag**, um edital vira card. Drive deve ser tão fácil quanto file-upload.
4. **Estados claros.** Skeleton loaders, progress steppers nomeados, toasts de sucesso/erro padronizados.
5. **Sem features fantasmas.** `/config` e `/admin` saem do menu até existirem de verdade (decisão na §6).

---

## 1. Decisões irrevogáveis (já confirmadas pelo usuário)

| Item | Decisão |
|---|---|
| Chat IA | Mantém `/chat` (página principal) **e** `ChatWidget` flutuante (apoio em todas as páginas). |
| `/admin` | **Remover do nav.** Manter rota acessível só por URL para debug interno. |
| `/config` | **Remover do nav.** Substituir por uma página pública `/como-funciona` que explica a lógica dos 4 agentes (objetivo educacional, não config). |
| Pipeline-first | Upload e Drive viram primeira-classe **dentro** do Kanban. `/upload` continua como rota dedicada (deep-link), mas o caminho default é arrastar no Kanban. |

---

## 2. Backend — endpoints novos

### 2.1 `POST /analyze/from-drive`
Aceita ingestão de **um** arquivo do Drive.

```jsonc
// Body
{
  "file_id": "1AbC...",         // OU
  "url": "https://drive.google.com/file/d/1AbC.../view",
  "edital_filename_override": "PRODESP-2024.pdf"  // opcional
}
// Response 202
{ "analysis_id": "uuid", "status": "queued", "poll_url": "/analyze/<id>" }
```

Implementação:
- Helper `_extract_drive_file_id(url)` (regex `/file/d/([^/]+)/`).
- Reusa `_drive_service()` de `tools/drive_tools.py`.
- `drive_svc.files().get_media(fileId=...)` → bytes → mesma chamada `_run_pipeline(...)`.
- Validação tamanho (≤30MB) e mime `application/pdf`.
- Erros: 404 (file não acessível pela SA), 413 (>30MB), 415 (não-PDF).

### 2.2 `POST /analyze/from-drive-folder`
Ingestão em massa de **uma pasta** do Drive — onboarding de portfólio inteiro.

```jsonc
{
  "folder_id": "1XyZ...",
  "max_files": 20  // default 10, hard cap 30
}
// Response 202
{
  "queued": 8,
  "skipped": 2,                // não-PDF ou >30MB
  "jobs": [
    { "analysis_id": "uuid1", "filename": "edital_a.pdf" },
    ...
  ]
}
```

- Lista PDFs com `drive_svc.files().list(q="'<folder>' in parents and mimeType='application/pdf' and trashed=false")`.
- Para cada PDF: cria `JobState`, agenda `BackgroundTasks(_run_pipeline, ...)`.
- Retorna lista de `analysis_id` para o frontend acompanhar todos.

### 2.3 `GET /analyze/by-ids?ids=a,b,c`
Polling em batch — evita N requests paralelos para bulk.

```jsonc
// Response
[
  { "analysis_id": "a", "status": "done", "pg_edital_id": "uuid", "score_comercial": 78, "filename": "..." },
  { "analysis_id": "b", "status": "running", "current_agent": "qualificador" },
  ...
]
```

### 2.4 `GET /chat/stream/{session_id}` (SSE)
Streaming do chat. **Fora do MVP do revamp** — fica para fase 2 (anotado, não implementado agora) para não atrasar.

### 2.5 Persistência de `_JOBS` em Postgres — **ENTRA NO MVP** ⚠️

**Por quê não dá pra adiar:** Cloud Run é stateless e o load balancer roteia requisições entre instâncias. Cenário típico de quebra:

1. Usuário importa pasta com 10 PDFs → request bate na **Instância A** → cria 10 entries em `_JOBS` (memória da A).
2. Frontend dispara polling `GET /analyze/by-ids` → load balancer joga para **Instância B**.
3. Instância B não conhece os jobs → retorna 404.
4. Frontend assume falha. Instância A segue processando, mas resultado é invisível. Pior: A pode hibernar por scale-to-zero antes de salvar nada.

Hoje funciona apenas porque rodamos com `min-instances=1, max-instances=1` — restrição que impede escalar para múltiplos vendedores simultâneos.

**Solução (mesma camada do chat):** Já temos `backend/tools/pg_tools.py` consolidado com Cloud SQL. Adicionar tabela `analysis_jobs`:

```sql
CREATE TABLE IF NOT EXISTS analysis_jobs (
  analysis_id              UUID PRIMARY KEY,
  status                   TEXT NOT NULL,                       -- queued|running|done|failed
  current_agent            TEXT,                                -- extrator|qualificador|analista|null
  edital_filename          TEXT,
  pg_edital_id             UUID,
  job_juridico_status      TEXT NOT NULL DEFAULT 'not_started',
  error                    TEXT,
  error_juridico           TEXT,
  edital_json              JSONB,
  result_json              JSONB,
  relatorio_juridico_json  JSONB,
  somatorio_drive_json     JSONB,
  estimated_seconds        INTEGER DEFAULT 35,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created ON analysis_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status  ON analysis_jobs(status);
```

Funções novas em `pg_tools.py`:
- `create_job(state: dict) -> None`
- `get_job(analysis_id: str) -> dict | None`
- `update_job(analysis_id: str, fields: dict) -> None`  *(usa `updated_at = now()` automático)*
- `get_jobs_by_ids(ids: list[str]) -> list[dict]`
- `mark_orphan_jobs_failed() -> int`  *(chamada no startup: marca como `failed('interrupted by restart')` qualquer job em `queued|running` há mais de 5 min)*

Refactor em `backend/main.py`:
- `_JOBS` vira **cache LRU read-through** (`cachetools.TTLCache(maxsize=200, ttl=300)`), não fonte da verdade.
- `_touch(job, **fields)` faz `await asyncio.to_thread(update_job, ...)` + invalida cache.
- `GET /analyze/{id}` e `GET /analyze/by-ids` leem do Postgres se cache miss.
- Startup hook adiciona `mark_orphan_jobs_failed()` após `ensure_schema()`.

Custo: ~60 linhas em `pg_tools.py` + ~30 linhas de refactor em `main.py`. Resolve o calcanhar de Aquiles antes do primeiro vendedor reclamar. Permite remover a restrição `max-instances=1` no Cloud Run e escalar de verdade.

---

## 3. Frontend — mudanças por página

### 3.1 `layout.tsx` (header global)

**Hoje:** header com logo Xertica em branco, badge "Licitações", nav, avatar com X red/black (some no fundo escuro), height `h-14`.

**Novo:**
- Height `h-16`, padding lateral `px-8`.
- Logo: `Logo_XERTICA_white.png` 24px → mantém.
- Badge "Licitações" → `text-[11px] tracking-[0.25em]` em `text-white/40`.
- Nav: items maiores `px-4 py-2 text-sm`, active state com underline gradient `cyan→pink` em vez de bg.
- Avatar substitui pelo símbolo **branco** (`X_symbol_variation4_Red_white.png` ou só `Logo_XERTICA_white.png` mini), em ring sutil `ring-white/15`.
- Background do header: `rgba(3,7,13,0.85)` + `blur(28px)` + linha inferior gradient `cyan/8% → transparent → pink/8%`.

**Nav final** (sem admin/config no nav principal):
```
Pipeline · Histórico · Chat IA · Como funciona
```
`Upload` desaparece do nav (passa a ser ação dentro do Pipeline). `/upload` continua existindo para deep-links e bookmarks.

### 3.2 `page.tsx` — Pipeline (Kanban)

**Hoje:** H1 `text-2xl`, kanban com 8 colunas estreitas (`w-172px`), botão `+ Novo edital` que vai pra `/upload`.

**Novo:**

#### 3.2.1 Hero / cabeçalho
- H1 `font-poppins font-bold text-4xl md:text-5xl tracking-tight text-white` com `fade-up`.
- Subtítulo: `{N} editais ativos · {M} APTO · {K} aguardando análise` em `text-sm text-white/50`.
- À direita: 3 botões compactos com tooltip:
  - **`+ Novo`** (dropdown abre menu: `Arquivo local | Do Google Drive | Pasta do Drive | URL pública`)
  - **`⌕ Buscar`** (abre searchbar inline)
  - **`▭ Filtros`** (abre painel lateral)
- Searchbar (collapsable): full-width, `placeholder="Buscar por órgão, número, objeto, vendedor…"`. Filtra cliente-side instantaneamente.
- Linha de filtros chips: `UF · Score · Vendedor · Prioridade`. Cada chip removível. Estado persistido em `localStorage`.

#### 3.2.2 Coluna "Novo" (drop-zone permanente)
- Primeira coluna do kanban (antes de "Identificação"), título `+ Novo edital`, fundo `border-dashed border-white/15`, hover `border-cyan/40 bg-cyan/5`.
- Aceita drag-drop de PDFs (múltiplos). Cada drop → cria card-skeleton imediatamente + chama `/analyze`.
- Card-skeleton mostra: nome do arquivo, barra de progresso por agente (extrator → qualificador → analista), tempo decorrido. Fica "preso" na coluna até `status=done`, então **animação** desliza para "Identificação" com o card real (orgão, score, badges).
- Botão central `+ Adicionar` abre o mesmo menu do header (file picker / Drive).

#### 3.2.3 Drag-and-drop de cards entre colunas
- Lib `@dnd-kit/core` + `@dnd-kit/sortable` (já leve, ~10kb).
- Substitui os botões `← →` que aparecem no hover.
- Drop em coluna nova → `PATCH /editais/{id} {fase_atual: ...}` com optimistic update + rollback em erro.

**Micro-interações premium (Linear/Notion-grade):** sensação tátil de que o card "descolou" da tela.

```css
/* Aplicado pelo @dnd-kit via data-attribute durante o drag */
.kanban-card[data-dragging="true"] {
  transform: rotate(3deg) scale(1.04);
  box-shadow:
    0 24px 60px rgba(0,0,0,0.45),
    0 0 0 1px var(--x-cyan),
    0 0 32px var(--x-cyan-glow);
  border-color: var(--x-cyan) !important;
  cursor: grabbing;
  z-index: 50;
  transition: transform 120ms cubic-bezier(0.16,1,0.3,1),
              box-shadow 200ms ease;
}
.kanban-card { cursor: grab; transition: transform 200ms cubic-bezier(0.16,1,0.3,1); }

/* Coluna alvo "respira" quando o card paira sobre ela */
.stage-col[data-drop-target="true"] {
  background: rgba(0,190,255,0.06);
  outline: 1px dashed rgba(0,190,255,0.4);
  outline-offset: -4px;
  transition: all 160ms ease-out;
}

/* Placeholder fantasma na origem */
.kanban-card-ghost {
  opacity: 0.3;
  filter: grayscale(0.6);
  transform: scale(0.98);
}
```

- `<DragOverlay>` do `@dnd-kit` renderiza o card flutuante com a inclinação.
- `useSortable` + `useDroppable` controlam `data-dragging` e `data-drop-target`.
- Som opcional sutil no drop (`<audio>` ~50ms tick) — desligável.
- Haptic feedback em mobile (`navigator.vibrate(10)` no `onDragStart`).

#### 3.2.4 Card melhor
- Border: `1px solid rgba(255,255,255,0.06)` → hover ganha **GlowCard** com mouse-tracking radial gradient da cor do stage.
- Tipografia: orgão em `text-sm font-semibold` (era `text-[11px]`), objeto em `text-xs text-white/45`.
- Badges: usar tokens `--x-*`. P1 vermelho, P2 pink, P3 cyan (em vez dos hex soltos).
- Densidade: `p-3` (era `p-2`).

#### 3.2.5 Empty state global
Se `editais.length === 0` no primeiro load:
- Hero centralizado: ícone grande, "Comece importando seu primeiro edital".
- Três GlowCards lado-a-lado: `Arquivo local | Do Google Drive | Pasta do Drive`.

### 3.3 `upload/page.tsx`

Vira a página dedicada / fallback. Recebe upgrade visual e ganha as abas.

- **Tabs no topo:** `Arquivo PDF | Google Drive | Pasta do Drive (em massa)`.
- Aba **Arquivo PDF**: o que já existe + visual-refresh (heading maior, drop-zone com `bg-grid` próprio sutil).
- Aba **Google Drive**: input para URL ou file-id + botão `Importar`. Mostra preview do nome do arquivo após validação (`HEAD` no Drive). Em sucesso → mesma UI de progresso atual.
- Aba **Pasta do Drive**: input para folder URL/ID + slider `máx. 1–30 arquivos` (default 10). Botão `Analisar pasta`. Em sucesso → lista cada PDF com mini-stepper individual + link `Abrir card no pipeline` quando termina.
- Metadados opcionais (órgão, UF, vendedor) escondidos atrás de `▾ Avançado` (collapsed by default).
- Tipografia: H1 `text-4xl` com `fade-up`.

**Callout SA-share (anti-fricção #1 do Drive):** acima do form das abas Drive e Pasta-do-Drive, banner premium fixo:

```
┌─────────────────────────────────────────────────────────────┐
│ 🛈  Antes de importar do Google Drive                       │
│                                                              │
│   Compartilhe o arquivo (ou pasta) com nossa conta de        │
│   serviço — basta acesso de leitura.                         │
│                                                              │
│   ┌──────────────────────────────────────────────────┐ ┌──┐ │
│   │ lici-adk-sa@operaciones-br.iam.gserviceaccount.com│ │📋│ │
│   └──────────────────────────────────────────────────┘ └──┘ │
│                                                              │
│   ▸ Como compartilhar (3 passos)         [ Ocultar dica ]   │
└─────────────────────────────────────────────────────────────┘
```

Especificação:
- Visual: `GlowCard` com cor `--x-cyan`, `.bg-orbs` mini contido, `border: 1px solid rgba(0,190,255,0.25)`, padding generoso.
- Email da SA em fonte mono (`font-roboto-mono`), selecionável, copyable com **botão `📋`** que vira ✓ verde por 2s ao copiar (`navigator.clipboard.writeText`).
- Origem do email: `NEXT_PUBLIC_LICI_SA_EMAIL` (env var no `next.config.js`) — backend já roda com essa SA.
- Disclosure `▸ Como compartilhar (3 passos)` expande mini-tutorial:
  1. Abra o arquivo/pasta no Google Drive.
  2. Clique em **Compartilhar** (canto superior direito).
  3. Cole o email acima e selecione **Leitor**. Pronto.
- Botão `[ Ocultar dica ]` salva `localStorage.lici_drive_callout_hidden=1`. Reaparece via link discreto `Mostrar dica de compartilhamento`.
- Quando o backend retorna `404 file_not_accessible_by_sa`, o callout reabre automaticamente com `border-orange` + texto extra: *"Não conseguimos acessar este arquivo. Confira se compartilhou com o email acima."*

Resultado: importação Drive vira fluxo de 3 cliques (copiar → colar no Drive → importar). Hoje é blocker invisível.

### 3.4 `historico/page.tsx`

- H1 `text-4xl font-bold` + subtítulo "Todos os editais já processados".
- Filtros já existem; refresh visual (chips em vez de selects soltos).
- **Novo:** botão `Exportar CSV` (cliente-side a partir do array filtrado).
- Tabela: rows com hover GlowCard sutil; status com badges tokenizadas.
- Skeleton rows enquanto carrega (5 rows fake animadas).

### 3.5 `edital/[id]/page.tsx`

(Já existe — não vou reescrever, apenas alinhar visual.)
- Header maior, breadcrumb `Pipeline · {orgão}`.
- Cards de seção viram GlowCards.
- Botão flutuante `💬 Perguntar à IA sobre este edital` no canto inferior-direito → abre `/chat?edital={id}` (já implementado).

### 3.6 `chat/page.tsx`

Mantém arquitetura atual (já está com GlowCards + brandbook). Apenas:
- Tipografia do welcome maior (`text-2xl` → `text-3xl`).
- Sidebar de sessões com fade-in stagger.
- **Não mexer** no streaming agora — fora de escopo.

### 3.7 `como-funciona/page.tsx` (NOVA)

Substitui `/config` e `/admin` no nav. Página pública educacional, ~1 scroll de altura.

Conteúdo:
1. **Hero**: "Como a IA da Xertica analisa seu edital" + animação dos 4 agentes em sequência.
2. **Pipeline visual** (timeline horizontal, 4 cards conectados por linha animada):
   - **1. Extrator** (cyan) — "Lê o PDF inteiro e extrai dados estruturados (órgão, modalidade, requisitos…)"
   - **2. Qualificador** (pink) — "Cruza requisitos com a base BigQuery de atestados/contratos da Xertica"
   - **3. Analista Comercial** (green) — "Calcula score 0-100% e classifica APTO / RESSALVAS / INAPTO"
   - **4. Analista Jurídico** (orange, sob-demanda) — "Avalia conformidade com Lei 14.133, súmulas TCU, riscos"
3. **Tempo médio**: "~35s para análise comercial completa".
4. **Fontes de dados**: BigQuery (atestados, contratos, certificações) · Google Drive (atestados específicos) · Lei 14.133 + Súmulas TCU.
5. **CTA**: `Analisar meu primeiro edital →` (vai para `/upload` ou `/`).

### 3.8 `admin/page.tsx`

Continua existindo (rota `/admin` acessível). Tira do nav. Sem nenhuma mudança visual urgente.

### 3.9 `config/page.tsx`

Mantida como rascunho técnico (ainda não funcional). Tira do nav. Adicionar banner topo "🔒 Página interna em desenvolvimento".

---

## 4. CSS / brandbook — refinos finais

`globals.css` precisa de:

1. **`.btn-primary` repaginado**: gradient `linear-gradient(135deg, var(--x-cyan), var(--primary))` em vez de cor sólida; shadow cyan glow.
2. **`.kanban-card` com GlowCard mouse-tracking** — mover o padrão do `chat-page` para CSS reutilizável (`.glow-card { background: ...; --mx; --my; }` + JS handler genérico em hook `useMouseGlow()`).
3. **Heading scale** (utilitário): `.heading-xl { @apply font-poppins font-bold text-4xl md:text-5xl tracking-tight text-white; }`.
4. **`.skeleton`**: classe utilitária com `animation: skeletonPulse 1.4s ease-in-out infinite` + gradient cinza→escuro.
5. **Orbs**: subir opacity de `0.15` para `0.22`, `0.18` para `0.25` no `.orb-pink`.
6. **`.bg-grid`**: aumentar contraste de `0.015` para `0.025` para grid ficar visível.
7. **Header underline ativo**: classe `.nav-active` com `border-bottom: 2px solid; border-image: linear-gradient(90deg, var(--x-cyan), var(--x-pink)) 1`.
8. **`.tabs-pill`**: pill switcher reutilizável (usado em `/upload`).
9. **Drop-zone style**: `.dropzone { @apply rounded-2xl border-2 border-dashed transition-all; }` + `.dropzone-active { @apply border-cyan-500/50 bg-cyan-500/5; }`.

---

## 5. Componentes novos / utilitários

| Caminho | Função |
|---|---|
| `components/glow-card.tsx` | `<GlowCard color icon label hint onClick>` extraído do `chat/page.tsx` para reuso. |
| `components/skeleton.tsx` | `<Skeleton className />` + `<KanbanCardSkeleton />`, `<TableRowSkeleton />`. |
| `components/dropdown-menu.tsx` | Menu simples (sem Radix) usado pelo `+ Novo` do header pipeline. |
| `components/upload-tabs.tsx` | Switcher `Arquivo / Drive / Pasta`. |
| `components/drive-import.tsx` | Form de import single-file Drive. |
| `components/drive-folder-import.tsx` | Form de import bulk Drive. |
| `components/searchbar.tsx` | Input + ⌕ debounced. |
| `components/filter-chips.tsx` | Chips removíveis. |
| `hooks/use-mouse-glow.ts` | Hook que injeta `--mx --my` no elemento. |
| `lib/drive.ts` | `extractDriveFileId(input: string)` cliente-side. |

Total: ~9 arquivos novos pequenos.

---

## 6. Decisão final sobre `/admin` e `/config`

| Rota | No nav? | Página | Conteúdo |
|---|---|---|---|
| `/admin` | **Não** | mantida | dashboard interno (já existe) |
| `/config` | **Não** | mantida (banner WIP) | placeholder atual |
| `/como-funciona` | **Sim** | NOVA | educacional pública (§3.7) |

---

## 7. Ordem de execução

Faseado para permitir deploy intermediário se algo der ruim.

### Fase A — Backend (commit + deploy independente)
- **A0. Persistência `analysis_jobs` em Postgres** (§2.5) — DDL + `pg_tools.create_job/get_job/update_job/get_jobs_by_ids/mark_orphan_jobs_failed`. Refactor `_JOBS` para cache TTL read-through.
- A1. `lib/drive.ts` (frontend) e helpers no backend.
- A2. `POST /analyze/from-drive` em `backend/main.py`.
- A3. `POST /analyze/from-drive-folder`.
- A4. `GET /analyze/by-ids` (já lê do Postgres após A0).
- A5. Testes manuais via `curl` (incluir simulação de "restart" entre POST e polling).
- A6. Deploy backend + remover restrição `max-instances=1` no `gcloud run deploy`.

### Fase B — Brandbook polish (CSS-only)
- B1. Tokens, heading-xl, skeleton, dropzone, tabs-pill, nav-active, orbs/grid bump em `globals.css`.
- B2. `layout.tsx`: header novo, nav novo (sem Upload/Admin/Config, com "Como funciona"), avatar correto.
- B3. Build + verificar visual antes de prosseguir.

### Fase C — Componentes reusáveis
- C1. `GlowCard`, `Skeleton`, `DropdownMenu`, `Searchbar`, `FilterChips`, `useMouseGlow`.
- C2. `UploadTabs`, `DriveImport`, `DriveFolderImport`.

### Fase D — Pipeline revamp
- D1. Hero novo com tipografia grande + busca + filter chips.
- D2. Coluna "Novo" com drop-zone permanente.
- D3. Card-skeleton em jobs em andamento (poll `/analyze/by-ids`).
- D4. Drag-and-drop entre colunas com `@dnd-kit`.
- D5. GlowCards nos kanban cards.
- D6. Empty state hero quando `editais.length === 0`.

### Fase E — Páginas auxiliares
- E1. `/upload` com tabs + Drive import.
- E2. `/historico` com export CSV + skeletons.
- E3. `/como-funciona` nova.
- E4. Banner WIP em `/config`.

### Fase F — Deploy + verificação
- F1. `gcloud builds submit` (web).
- F2. `gcloud run deploy x-lici-web`.
- F3. Smoke test manual: pipeline carrega, drop PDF funciona, drop pasta Drive funciona, drag entre colunas, filtros, busca, /como-funciona renderiza, chat e widget OK.

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Drive SA sem permissão na pasta do usuário | **Callout permanente** nas abas Drive/Pasta (§3.3) com email da SA + botão Copiar + tutorial 3-passos; backend retorna `404 file_not_accessible_by_sa` que reativa o callout em laranja. |
| `@dnd-kit` quebra mobile/touch | Usar `PointerSensor` com `activationConstraint: { distance: 6 }` e `TouchSensor`; fallback botões `← →` permanecem em mobile. |
| `/analyze/by-ids` com 30 jobs simultâneos sobrecarrega Cloud Run | Hard cap 30 + queue serializada no backend (`asyncio.Semaphore(3)` no `_run_pipeline`). Permite remover `max-instances=1` após persistência (§2.5). |
| **In-memory `_JOBS` quebra com múltiplas instâncias / scale-to-zero** | **RESOLVIDO no MVP** via §2.5 — persistência em Postgres `analysis_jobs` + `mark_orphan_jobs_failed()` no startup. |
| GlowCard com mouse-tracking pesado em listas grandes | Aplicar só em hover (event listener `onMouseEnter` adiciona o handler, `onMouseLeave` remove). |
| Visual quebrar em ecrãs pequenos | Manter grid-cols responsivo; testar em 1280, 1440, 1920. |
| Drag-overlay com `rotate(3deg) scale(1.04)` causa repaint pesado em kanban com 100+ cards | `will-change: transform` só durante o drag; `transform` com GPU compositing; `<DragOverlay>` renderiza fora da árvore principal. |

---

## 9. Critérios de aceitação

- [ ] Header com nav `Pipeline · Histórico · Chat IA · Como funciona` (sem Upload/Admin/Config).
- [ ] Avatar do header não some no fundo escuro (símbolo X branco visível).
- [ ] Kanban tem coluna "Novo" que aceita drag-drop de PDFs e cria card-skeleton imediato.
- [ ] Botão `+ Novo` no header do Kanban abre dropdown com 4 opções (local / Drive / Pasta / URL).
- [ ] Drag-and-drop funcional entre colunas (com optimistic update).
- [ ] **Card durante drag tem `rotate(3deg) scale(1.04)` + cyan glow.** Coluna alvo respira em cyan. Origem fica fantasma 30%.
- [ ] Searchbar filtra cards por órgão/objeto/número instantaneamente.
- [ ] `POST /analyze/from-drive` aceita URL ou file-id e processa um PDF do Drive.
- [ ] `POST /analyze/from-drive-folder` enfileira até 10 PDFs de uma pasta.
- [ ] **Callout SA-email** visível nas abas Drive/Pasta com botão Copiar funcional.
- [ ] **Persistência Postgres `analysis_jobs`**: kill da instância no meio do bulk import → polling continua retornando status corretos.
- [ ] Cloud Run roda **sem `max-instances=1`** (escalável).
- [ ] Página `/como-funciona` existe e explica os 4 agentes.
- [ ] `/admin` e `/config` continuam acessíveis por URL mas sumiram do menu.
- [ ] Tipografia: H1s usam `text-4xl/5xl font-poppins`. Headers ganharam respiro.
- [ ] Cards do Kanban têm hover GlowCard.
- [ ] Skeletons aparecem em loadings de 200ms+.
- [ ] Build do frontend passa sem warnings novos.
- [ ] Deploy Cloud Run sem erros.

---

## 10. O que **NÃO** está neste revamp (assumido fora de escopo)

- Google Picker API com OAuth do usuário (continua só com SA).
- I18n.
- Mobile-first deep review (faremos pass rápido, sem refactor).

---

# REVISÃO 2 — Inovação + Confiabilidade

A v1 acima entrega "bom revamp". Esta revisão sobe para **enterprise-grade + diferencial real**. Adições agrupadas por categoria.

---

## 11. Confiabilidade (production-grade)

### 11.1 Persistência de jobs (`_JOBS` → Postgres)
**Por quê:** Cloud Run pode reciclar instância a qualquer momento. Hoje, **bulk de 10 PDFs** durante deploy = perde tudo. É o risco #1 do app.

**Como:**
- Nova tabela `analysis_jobs` em Postgres:
  ```sql
  CREATE TABLE analysis_jobs (
    analysis_id    UUID PRIMARY KEY,
    status         TEXT NOT NULL,         -- queued|running|done|failed
    current_agent  TEXT,
    edital_filename TEXT,
    pg_edital_id   UUID,
    job_juridico_status TEXT DEFAULT 'not_started',
    error          TEXT,
    error_juridico TEXT,
    edital_json    JSONB,
    result_json    JSONB,
    relatorio_juridico_json JSONB,
    somatorio_drive_json JSONB,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
  );
  ```
- `_JOBS` vira **cache** em memória (read-through) com fallback para Postgres.
- Cada `_touch()` faz `UPDATE` async via `asyncio.to_thread`.
- Em startup, query `WHERE status IN ('queued','running')` e marca como `failed("interrupted by restart")`.

### 11.2 Retry + circuit breaker no proxy Next.js
**Por quê:** Cold start do backend Cloud Run = 504 sporádico. Hoje frontend mostra erro genérico.

**Como:**
- `lib/backend.ts` ganha wrapper `fetchWithRetry(url, opts, { retries: 3, backoff: [400, 1200, 3000] })`.
- Detecta 502/503/504 + network errors. 4xx (exceto 429) NÃO retentam.
- Circuit breaker simples: se 5 falhas em 30s, abre por 60s e mostra banner global "Backend instável, reconectando…".

### 11.3 Health check rico
- `GET /health` retorna agora: `{ status, jobs_in_memory, pg_ok, bq_ok, drive_ok, vertex_region, version, uptime_s }`.
- Cada subsystem testado em paralelo com timeout 1s. Status `degraded` se algum falhar.
- Frontend exibe `🟢 / 🟡 / 🔴` no canto inferior do header.

### 11.4 Idempotência do upload
**Por quê:** Usuário double-clica "Analisar". Hoje gera 2 jobs e cobra 2× o Vertex.
- `POST /analyze` aceita header `Idempotency-Key: <uuid>`. Frontend gera por ação. Backend dedupe por 5min em cache LRU.

### 11.5 Rate limit
- Middleware FastAPI: 30 req/min por usuário (header `X-User-Email` do NextAuth proxy). 429 com `Retry-After`.
- Específico para `/analyze`: 5/min por usuário.

### 11.6 Observabilidade visível ao usuário
- Cada job ganha `trace_id` linkável: `/admin/traces/{trace_id}` mostra timeline JSONL parsed (extrator → qualificador → analista) com tempos, prompts, custos estimados em tokens.
- Útil para debug e para o vendedor entender por que o score deu X.

### 11.7 Backup BigQuery → snapshots semanais
- Cloud Scheduler já existe. Adicionar job `bq cp --snapshot dataset.table dataset_backup.table_<date>` semanal. (Anotação ops, não código no app.)

---

## 12. Features inovadoras (diferencial real)

### 12.1 **Comparador de editais** ⭐
**Caso de uso:** "Já analisei 3 pregões parecidos do PRODESP em 2025. Este novo é mais arriscado?"

- Página `/comparar?ids=a,b,c` (ou seleção múltipla no histórico → botão `⇄ Comparar`).
- Tabela side-by-side: requisitos, scores, gaps, risco jurídico, valor estimado, vendedor, status final.
- **Killer feature:** highlight automático de **diferenças** (cor) e **convergências** (cinza). LLM gera resumo "este edital pede 30% mais volume de UST que os anteriores e adiciona requisito X que não tínhamos".

### 12.2 **Similaridade automática** ⭐
**Caso de uso:** "Acabei de subir um edital — já participei de algo parecido?"

- Embedding (`text-embedding-005`) do `edital.objeto + requisitos` no momento da extração.
- Coluna `embedding VECTOR(768)` em `editais` (Postgres `pgvector`).
- Em `/edital/[id]`, novo bloco "**📎 Editais similares**": top-5 cosine-sim com link e score.
- Backend: `GET /editais/{id}/similares?k=5`.

### 12.3 **Smart re-rank do pipeline (Bayesian score)** ⭐
**Caso de uso:** Pipeline com 50 cards. Qual focar HOJE?

- Score derivado: `prioridade_dinamica = score_aderencia × peso_valor × decay_prazo × historico_orgao`.
  - `peso_valor`: log10(valor_estimado) normalizado.
  - `decay_prazo`: explosivo nos últimos 5 dias antes do encerramento.
  - `historico_orgao`: % de ganhos com aquele órgão (BQ).
- Card ganha badge `🔥 Top 5 hoje` para os 5 maiores.
- Toggle no header do Kanban: `Ordenar por: Manual | Smart`.

### 12.4 **Diff de versões do edital** ⭐
**Caso de uso:** Órgão publica errata. Vendedor sobe v2 — o que mudou?

- Botão `📎 Substituir PDF` no card de edital. Faz upload nova versão.
- Backend reroda extrator + qualificador, mas guarda `editais.versions` (jsonb array).
- UI mostra diff lado-a-lado dos campos extraídos: requisitos novos (verde), removidos (vermelho), alterados (amarelo).

### 12.5 **Geração de proposta técnica draft** ⭐
**Caso de uso:** Análise terminou APTO → próximo passo é escrever proposta. Hoje faz à mão.

- Novo agente `gerador_proposta` que recebe `edital + atestados_drive + perfil_xertica` e gera:
  - Sumário executivo
  - Capacidade técnica (linkando atestados específicos)
  - Metodologia (template editável por vertical: GCP / Workspace / IA)
  - Equipe sugerida (lê de `certificacoes` no BQ)
  - Cronograma macro
- Output: HTML editável + export `.docx` (lib `docx` no Python).
- Endpoint: `POST /editais/{id}/proposta_draft`.

### 12.6 **Modo "war-room" para edital ativo**
**Caso de uso:** Dia da disputa. Time todo olhando o mesmo edital.
- Página `/edital/{id}/war-room` (estende a existente):
  - Timer regressivo grande (encerramento).
  - Checklist de habilitação (clicável).
  - Chat IA pinned.
  - Comentários em tempo real (já existe backend `add_comentario` — só falta UI com WebSocket/polling 5s).
  - Co-presença: avatar de quem está olhando agora.

### 12.7 **Alertas inteligentes (Slack/email)**
- Cloud Scheduler diário 8h: identifica editais com `decay_prazo < 3 dias` e `score >= 70` ainda em fase `analise`/`pre_disputa` → manda mensagem para vendedor + gerente.
- Endpoint `/internal/alerts/run` chamado pelo scheduler.
- Config simples em var ambiente: `LICI_SLACK_WEBHOOK`, `LICI_ALERT_EMAILS`.

### 12.8 **Briefing por voz / NotebookLM-like**
- Botão `🎧 Ouvir resumo (3min)` no `/edital/{id}`.
- Chama Gemini TTS (ou ElevenLabs) com script gerado: "Edital do PRODESP, valor X, score Y, 3 alertas críticos: A, B, C. Próximo passo: Z."
- MP3 inline player. Vendedor ouve no carro.

### 12.9 **Chat com contexto multi-edital**
**Caso de uso:** "Compare estes 3 editais e me diga qual atacar primeiro" — sem ter que abrir 3 abas.
- Chat IA aceita selecionar **N editais** como contexto via chip-input no header do chat.
- Sessão guarda `edital_ids: []` (já existe campo, expandir para array).

### 12.10 **OCR fallback para PDFs escaneados**
**Por quê:** ~10% dos editais municipais são scan ruim, Gemini extrai pouco.
- Detecção: se `len(texto_extraído) / num_páginas < 200`, dispara fallback Document AI OCR.
- Adiciona ~15s mas resolve o caso ruim. Custo aceitável.

### 12.11 **Plug-in Drive: pasta de monitoramento**
**Caso de uso:** Time joga PDFs numa pasta — sistema importa sozinho.
- Em `/upload` aba "Pasta do Drive", checkbox `📌 Monitorar essa pasta diariamente`.
- Cloud Scheduler chama `/internal/drive/sync_inbox` 2× ao dia.
- Lista pastas registradas; imports novos PDFs (idempotente por `drive_file_id`).

### 12.12 **Exportar pipeline para Sheets**
- Botão no `/historico` e `/`: `📊 Abrir no Sheets`.
- Backend `POST /export/sheet` cria spreadsheet via Sheets API (SA já tem auth Drive). Retorna URL.

---

## 13. UX premium (detalhes que diferenciam)

### 13.1 Command palette (⌘K)
- `cmdk` lib (~3kb).
- Atalhos: `⌘K` global, `?` mostra atalhos, `n` novo, `g h` histórico, `g c` chat, `g p` pipeline.
- Lista busca em editais, ações ("Importar do Drive…", "Comparar selecionados…"), navegação.

### 13.2 Optimistic UI everywhere
- Drag-drop, mudança de fase, comentários, deletes — todos otimistas com rollback animado em erro.
- Toast com `↶ Desfazer` (5s) em deletes (`bulk_delete`).

### 13.3 Co-presença + activity log
- Quem está vendo cada edital agora (avatar pile no canto). Polling leve.
- Activity log no card: "Maria moveu para Disputa há 2h", "João comentou".

### 13.4 Notificações in-app
- Sino no header. Lista de eventos: "Análise X terminou (APTO 78%)", "Prazo de Y vence em 2 dias".
- Backend `GET /notifications?since=...` lê de `movimentacoes` + `comentarios` filtrados por `vendedor_email = me`.

### 13.5 Skeletons + transições
- View transitions API (Chrome/Edge nativos): fade entre páginas.
- Skeletons em todos os loadings >150ms.

### 13.6 Dark/Light toggle
- Brandbook é dark-first, mas algumas reuniões pedem print claro. Toggle no header com `prefers-color-scheme` default.
- (Adiciona ~1 dia de CSS — opcional, marcar como nice-to-have.)

### 13.7 Atalhos por linha
- `j/k` navega entre cards/linhas.
- `Enter` abre.
- `e` edita (modal inline).
- `delete` remove (com confirmação inline).

### 13.8 Toasts + Sonner
- Trocar `ToastStack` caseiro por `sonner` (~5kb, padrão de mercado, melhor a11y).

### 13.9 Loading bar topo
- `nprogress` ou custom — barra fina cyan no topo durante navegação Next.js.

### 13.10 Animações de entrada nos cards
- Stagger fade-up nas colunas do Kanban + nas linhas do histórico.

---

## 14. Segurança + governança

### 14.1 RBAC mínimo
- `vendedor`: vê só o que é dele + comum. Não deleta editais alheios.
- `gerente`: vê tudo + alertas agregados.
- `admin`: tudo + `/admin`.
- Lista whitelisted em var ambiente `LICI_ADMINS=email1,email2`. Decide via `session.user.email` no NextAuth.
- Backend valida via header propagado pelo proxy.

### 14.2 Audit log
- Tabela `audit_log` no Postgres: `{user, action, entity_type, entity_id, payload, ts}`.
- Toda mutação (PATCH, DELETE, bulk_delete, mover stage) grava.
- Página `/admin/audit` (acessível só admin) mostra timeline.

### 14.3 PII redaction nos logs
- `logging_config.py`: filtro que redacta CPF/CNPJ/email/telefone em mensagens log.
- Regex compilado uma vez.

### 14.4 CSP headers no Next
- `next.config.js`: `Content-Security-Policy`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.

### 14.5 Lock de cota Vertex
- Variable `LICI_DAILY_VERTEX_BUDGET_USD=50` (exemplo). Telemetria que soma custos por job.
- Acima do limite: `/analyze` retorna 429 "Cota diária do dia atingida".

---

## 15. Performance

### 15.1 Edge runtime no proxy
- `/api/proxy/[...path]/route.ts` migrar para `export const runtime = 'edge'` — latência -100ms.

### 15.2 React Query (TanStack Query)
- Substituir `useEffect + useState + fetch` por `useQuery`. Cache, dedupe, refetch on focus.
- Aplica em pipeline, histórico, edital detail, chat sessions.

### 15.3 Imagens locais
- Migrar logos de GCS público para `web/public/`. Versionar.
- `next/image` com priority no header.

### 15.4 Code splitting
- Páginas pesadas (chat, edital detail) usam `dynamic()` para sub-componentes grandes (ex: ParecerView, MdContent renderer).

### 15.5 Cache no histórico (BigQuery)
- BQ é caro. Cache 60s em Redis-lite (in-memory `cachetools.TTLCache`) para `/analyses` queries comuns.

---

## 16. Testes mínimos

- **Backend:** pytest para os novos endpoints `/analyze/from-drive*`, `/editais/similares`, `/export/sheet`. Mock Drive API.
- **Frontend:** Playwright smoke test:
  1. Login → Pipeline carrega.
  2. Drag PDF na coluna Novo → card aparece skeleton.
  3. Após mock done → card vira card real.
  4. Drag entre colunas → PATCH chamado.
  5. Search filtra.
  6. `/como-funciona` renderiza.
- 1 hora de setup. Roda em PR via GitHub Actions.

---

## 17. Documentação para o usuário final

- **Tour guiado** primeira visita (lib `driver.js`, ~10kb): destaca header, pipeline, +Novo, busca, chat. Skip e "não mostrar de novo".
- **Empty-state ilustrado** em cada página (não apenas Kanban).
- **Tooltip everywhere**: ícones com `title` mínimo.
- **Página `/sobre`** (substitui `/como-funciona` da v1): história + agentes + créditos + versão + status backend.

---

## 18. Roadmap revisado (com novidades)

| Fase | Conteúdo | Risco |
|---|---|---|
| **A — Backend essencial** | Drive endpoints (§2), persistência `_JOBS` (§11.1), idempotência (§11.4), retry no proxy (§11.2), health rico (§11.3) | baixo |
| **B — Brandbook polish** | CSS tokens, header, skeletons, GlowCards, tipografia | baixo |
| **C — Componentes** | GlowCard, Skeleton, DropdownMenu, Searchbar, FilterChips, UploadTabs, DriveImport, CommandPalette (⌘K), Toaster (sonner) | baixo |
| **D — Pipeline revamp** | Hero, drop-zone "Novo", drag-drop, GlowCards, busca, filtros, smart-rank toggle (§12.3) | médio |
| **E — Páginas auxiliares** | `/upload` tabs, `/historico` export, `/sobre`, ajustes detail, war-room v1 (§12.6) | baixo |
| **F — Inovação 1** | Similaridade pgvector (§12.2), comparador (§12.1), notificações in-app (§13.4), audit log (§14.2) | médio |
| **G — Inovação 2** | Diff de versões (§12.4), proposta draft (§12.5), alertas Slack (§12.7), pasta-watch (§12.11), Sheets export (§12.12) | médio |
| **H — Polimento** | RBAC (§14.1), CSP (§14.4), React Query (§15.2), Playwright tests (§16), tour guiado (§17), TTS briefing (§12.8) | baixo |
| **I — Deploy + monitor** | Build, deploy, smoke test, monitor 24h | — |

**Tempo estimado relativo:** A=1×, B=0.5×, C=1×, D=2×, E=1.5×, F=2×, G=2×, H=1.5×, I=0.5× → fases podem deployar independentes.

---

## 19. Top-10 features que valem mais a pena (priorização afiada)

Se tiver que cortar, mantenha estas (ordem por impacto/esforço):

1. **Drive endpoints + drop-zone no Kanban** (§2 + §3.2.2) — desbloqueia ingestão.
2. **Persistência `_JOBS` Postgres** (§11.1) — confiabilidade #1.
3. **Brandbook polish + tipografia** (§B) — resolve "feio".
4. **Drag-and-drop entre colunas** (§3.2.3) — UX fundamental Kanban.
5. **Busca + filtros chips** (§3.2.1) — sem isso 50 editais é inutilizável.
6. **Similaridade pgvector** (§12.2) — diferencial visível em 1 semana de uso.
7. **Comparador de editais** (§12.1) — pedido recorrente de vendedor.
8. **Smart rank** (§12.3) — "qual atacar HOJE" responde sozinho.
9. **Command palette ⌘K** (§13.1) — power-user lover.
10. **Audit log + RBAC** (§14.1, §14.2) — compliance + multiusuário.

---

## 20. Critério final de "100%"

App está em "100% inovador + confiável" quando:

- ✅ Vendedor não-técnico consegue: ingerir edital (3 cliques), entender resultado (1 olhada no card), agir (drag entre colunas), decidir (comparador + smart rank).
- ✅ Time consegue colaborar: comentários, alertas, war-room, audit.
- ✅ Sysadmin dorme tranquilo: jobs sobrevivem restart, retry no front, health visível, audit log, RBAC, idempotência, rate limit.
- ✅ Diferencial demonstrável em demo: similaridade automática, comparador, proposta draft, briefing por voz, ⌘K.
- ✅ Visual: brandbook impecável, tipografia premium, skeletons, animações sutis, GlowCards.

---

---

# REVISÃO 3 — Lacunas reais não cobertas nas revisões anteriores

Após releitura completa, 15 itens de alto impacto ainda ausentes.

---

## 21. Chat SSE streaming — sair do out-of-scope

**Por quê entrar agora:** O chat já usa polling 3s. Para respostas longas do Gemini (proposta draft, análise jurídica completa) são 15–30s de tela em branco. Isso quebra a sensação de IA "pensando". Linear, Claude, ChatGPT — todos streamam. Polling é dealbreaker em demo.

**Como (é mais simples do que parece):**
- Backend: `GET /chat/stream/{session_id}/latest` com `StreamingResponse` + `Content-Type: text/event-stream`. Chama `chat_agent.stream(...)` via Vertex AI `generate_content(stream=True)`.
- Frontend: `EventSource(url)` em `chat/page.tsx`. Substitui o `startPolling()` atual apenas no bloco de envio de mensagem. Sidebar de histórico continua com fetch normal.
- Animação: tokens renderizam progressivamente via estado `streamBuffer`. Cursor pulsante `▌` no final enquanto stream abierto.
- Fallback: se `EventSource` não suportado (Safari antigo), cai para polling atual.
- Escopo cirúrgico: **só** a parte de render de mensagem nova. Não toca histórico, sessões, upload — nada mais.

---

## 22. Score breakdown — "Por que 78%?"

**Caso de uso:** Vendedor vê 78% e não sabe se deve ir pra disputa. O score é opaco.

**O diferencial:** painel interativo no `/edital/[id]` com vizualização do breakdown do score:

```
Score Comercial: 78%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Atestado GWS · 5000 licenças      +22pts  [ver atestado]
✅ Certificação Google Partner        +15pts
✅ Contrato PRODESP 2023              +18pts
⚠️  Volume GCP < exigido (80% coberto) +12pts  ← gap
❌ Atestado GFS ausente                 0pts  ← bloqueante
❌ Parcela Maior Relevância em falta    0pts  ← bloqueante
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Máximo alcançável sem novos atestados: 84%
```

- Dados já existem em `parecer.evidencias` e `parecer.gaps` — só falta renderizar com peso.
- Cada linha clicável: expande texto da evidência ou gap.
- Badge `🔴 Bloqueante` nos itens que impedem habilitação.
- Linha "Máximo alcançável" = score se os gaps não-bloqueantes fossem resolvidos.
- Botão `Solicitar atestado` ao lado de cada gap: abre chat com prompt pré-preenchido "Qual contrato pode gerar atestado para cobrir o requisito X?".

---

## 23. Detecção de duplicata no upload

**Problema atual:** Usuário clica duas vezes em "Analisar" ou reimporta a mesma pasta — gera 2 jobs idênticos, 2 cards no pipeline, cobra 2× o Vertex.

**Solução:**
- No `POST /analyze`, após validar o PDF, calcular `sha256(pdf_bytes)`.
- Query `SELECT analysis_id, pg_edital_id FROM analysis_jobs WHERE pdf_sha256 = $1 AND status != 'failed' AND created_at > now() - interval '30 days'`.
- Se encontrar: retornar `HTTP 200 { "analysis_id": existing, "status": "already_exists", "pg_edital_id": ... }` em vez de `202 queued`.
- Frontend detecta `status: already_exists` → toast `"Este edital já foi importado (ver card →)"` com link.
- Coluna `pdf_sha256 TEXT` em `analysis_jobs`.
- Mesmo hash para `from-drive`: calcular após download dos bytes.

---

## 24. Stage gates — UI para o checklist que já existe no backend

**Problema:** Backend já tem `seed_gates()`, `list_gates()`, `set_gate()` em `pg_tools.py`. Cada fase tem um checklist de gates (ex: `identificacao` → `["proposta_inicial_enviada", "valor_confirmado"]`, `homologado` → `["ata_salva_drive"]`). Mas isso **não aparece em nenhuma tela**.

**Solução:**
- No detalhe `/edital/[id]`, após o header de fase, adicionar bloco **"Checklist desta fase"**:
  ```
  Fase: Pré-disputa
  ┌─────────────────────────────────────────┐
  │ ☑  Proposta técnica rascunhada          │
  │ ☑  Preço verificado com gerente         │
  │ ☐  Documentação de habilitação revisada │  ← pending
  │ ☐  Credenciamento no portal confirmado  │  ← pending
  └─────────────────────────────────────────┘
  [Avançar para Proposta →]  (desabilitado até todos os gates)
  ```
- `GET /editais/{id}/gates` → lista gates com `done: bool`.
- `PATCH /editais/{id}/gates/{gate_key}` → marca como done (já existe `set_gate`).
- Botão "Avançar para próxima fase" no kanban card só aparece quando todos os gates da fase atual estão marcados. (Opção de override com confirmação para gerente.)
- Gates configuráveis por variável de ambiente `LICI_CUSTOM_GATES` (JSON) para cada projeto customizar.

---

## 25. Importar de URL pública (portais governamentais)

**Caso de uso:** O edital está no PNCP, Comprasnet, BEC-SP ou portal do órgão com PDF acessível publicamente. Vendedor cola a URL — sistema baixa e analisa.

**Dropdown `+ Novo` → aba `URL pública`**.

Backend: `POST /analyze/from-url`
```jsonc
{ "url": "https://comprasnet.gov.br/.../edital.pdf" }
```
- `httpx.get(url, follow_redirects=True, timeout=30)` com User-Agent real.
- Validação: mime `application/pdf`, tamanho ≤ 30MB.
- Para portais que exigem login (BEC-SP): retornar `422 portal_requires_auth` com instrução de download manual.
- Detecção de portais conhecidos:
  ```python
  KNOWN_PORTALS = {
    "www.comprasnet.gov.br": "Comprasnet",
    "www.bec.sp.gov.br":     "BEC-SP",
    "pncp.gov.br":           "PNCP",
    "licitacoes-e.bb.com.br":"Licitações-e",
  }
  ```
- Se portal reconhecido: log especial `portal_import.{nome}` para métricas.
- Mesmo pipeline de análise após download.

Frontend: input de URL com validação visual (ícone do portal detectado auto-aparece), botão `Baixar e Analisar`.

---

## 26. PDF inline preview no detalhe do edital

**Problema:** Usuário quer consultar uma cláusula específica enquanto lê a análise. Hoje precisa ir ao Drive, baixar, abrir. É 5 passos desnecessários.

**Solução:**
- Backend: `GET /analyze/{id}/pdf` → stream do PDF original (buscado do job por `edital_filename` + guarda bytes em `analysis_jobs.pdf_bytes` — ou lê do Drive se veio via Drive).
  - Alternativa mais leve: `GET /analyze/{id}/pdf-url` retorna URL assinada do GCS (se guardarmos o PDF no bucket `etp-bucket/editais/{analysis_id}/original.pdf` após upload).
- Frontend: no `/edital/[id]`, botão `📄 Ver PDF original` abre drawer lateral com `<iframe src="/api/proxy/analyze/{id}/pdf">`.
- Mobile: link download em vez do iframe.
- Armazenamento: PDF salvo em `gs://etp-bucket/editais/{analysis_id}/original.pdf` no momento do upload (via `storage.Client().bucket(...).blob(...).upload_from_string(pdf_bytes)`). TTL de 90 dias.

---

## 27. Timeline visual do edital (backend pronto, UI faltando)

**Backend já tem:** `add_movimentacao()` + `list_movimentacoes()` em `pg_tools.py`. Registra quem moveu, quando, para qual fase.

**O que falta: UI.**

No `/edital/[id]`, novo bloco colapsável "**Histórico de movimentações**":

```
● Hoje 14:23 · João moveu para Pré-disputa
│ "Análise aprovada pela gerência"
│
● Ontem 09:15 · Pipeline IA concluiu análise
│ Score: 78% · 3 gaps identificados
│
● 28 Abr · Maria criou o edital
  Arquivo: PRODESP-2024-001.pdf
```

- Dots coloridos com a cor do stage (`--x-*` do brandbook).
- Linha vertical conectando.
- `GET /editais/{id}/movimentacoes` — já existe.
- Comentários inline: `+` icon abre textarea para adicionar comentário diretamente na timeline (chama `POST /editais/{id}/comentarios`).

---

## 28. Visão "histórico do órgão" no detalhe

**Caso de uso:** "Esse PRODESP — já participamos antes? Ganhamos ou perdemos? Qual foi o score?"

No `/edital/[id]`, novo bloco **"Histórico com este órgão"**:

```
PRODESP  ·  3 participações anteriores
─────────────────────────────────────
✅ GANHO   PRODESP-2023-001  Score 82%  Valor R$ 1.2M
⚠  PERDIDO PRODESP-2023-005  Score 71%  Valor R$ 800k
✅ GANHO   PRODESP-2022-010  Score 88%  Valor R$ 2.1M

Win rate: 67%  ·  Score médio: 80%  ·  Ticket médio: R$ 1.37M
```

- Query: `SELECT * FROM editais WHERE lower(orgao) = lower($1) AND edital_id != $2 ORDER BY criado_em DESC LIMIT 5`.
- Endpoint: `GET /editais/{id}/historico-orgao`.
- Bloco aparece só se houver ≥1 participação anterior. Zero participações → `"Primeira participação com este órgão."` em badge cyan.

---

## 29. CI/CD automático — GitHub Actions

**Problema atual:** Deploy é totalmente manual (terminal + gcloud). Nenhuma proteção contra quebrar produção.

**Solução:** `.github/workflows/` com dois pipelines:

**`ci.yml`** — roda em todo PR:
```yaml
- checkout + setup Python
- pip install + pytest backend/ (com mocks)
- npm ci + next build (web/)
- report status no PR
```

**`deploy.yml`** — roda em push para `main` (após CI passar):
```yaml
- backend:  gcloud builds submit → gcloud run deploy x-lici-bff
- frontend: gcloud builds submit → gcloud run deploy x-lici-web
- notify:   curl $LICI_SLACK_WEBHOOK com link da revisão
```

Exige: `GOOGLE_CREDENTIALS` como secret (SA JSON com roles `Cloud Run Admin + Storage Admin`).

Benefícios: todo merge em main = deploy automático em <5min. Histórico de deploys. Rollback fácil (`gcloud run revisions rollback`).

---

## 30. Notificação quando análise termina (email/in-app)

**Problema:** Análise leva 35s. Usuário clica "Analisar", vai pro café, volta, a janela está em idle, o polling parou. Não sabe que terminou.

**Solução dupla:**

**In-app** (já planejado em §13.4 — detalhar aqui):
- Backend: ao `_touch(job, status="done")`, insere em tabela `notifications(user_email, type, payload, created_at, read_at)`.
- Frontend: sino no header faz poll `GET /notifications?unread=true` a cada 30s. Badge vermelho com contagem.
- Clique no sino → dropdown com notificações. Clique na notificação → navega para o edital.

**Email:**
- Ao completar job, se `LICI_NOTIFY_EMAIL=true` e job tem `vendedor_email`:
  ```python
  send_email(
    to=vendedor_email,
    subject=f"Análise concluída: {orgao} — Score {score}%",
    body=html_template.render(orgao, score, status, url)
  )
  ```
- Usar `google.cloud.api_gateway` ou simples `smtp` (via Gmail API com SA). 
- Template HTML brandbook-styled (dark background, cyans, Poppins via inline CSS).
- Opt-out com `unsubscribe_token` no email.

---

## 31. Bulk edit — editar múltiplos editais de uma vez

**Problema:** Hoje `BulkActionBar` só tem "Apagar". Comum precisar re-atribuir vendedor nos 10 editais de uma UF ou mudar prioridade de um lote.

**Solução:** ao selecionar cards, `BulkActionBar` ganha menu desdobrável "`⋯ Mais ações`":
- `Atribuir vendedor` → input email → `PATCH /editais/bulk_update {ids, vendedor_email}`
- `Mudar prioridade` → select P1-P5 → `PATCH /editais/bulk_update {ids, prioridade}`
- `Mover para fase` → select fase → confirma → `PATCH /editais/bulk_update {ids, fase_atual}`
- `Exportar selecionados como CSV`

Backend: `POST /editais/bulk_update` com `{ids: [], fields: {...}}`. Valida campos permitidos (whitelist). Grava `audit_log` por item.

---

## 32. Export PDF do parecer completo

**Caso de uso:** Gerente quer aprovar participação. Vendedor precisa enviar o parecer em PDF para o email do gerente, não um link que pode expirar.

**Solução:**
- Endpoint `GET /editais/{id}/parecer.pdf`
- Backend WeasyPrint (já tem `pip install weasyprint` em muitos projetos Python) ou `jinja2` → HTML → PDF.
- Template: logo Xertica, header com dados do edital, score em destaque, evidências, gaps, análise jurídica se disponível.
- Cloud Run precisa de `--memory=512Mi` (WeasyPrint usa mais memória).
- Frontend: botão `⬇ Baixar parecer (PDF)` no `/edital/[id]` ao lado de outros botões.

---

## 33. Status page `/status`

**Caso de uso:** Backend está lento? Usuário não sabe se é ele ou o sistema.

**Solução:**
- Rota Next.js `/status` (pública, sem auth).
- Faz `fetch('/api/proxy/health')` e exibe:
  ```
  ✅ API              ok  (23ms)
  ✅ Banco de dados   ok  (8ms)
  ✅ Gemini / Vertex  ok  (usa region: us-central1)
  ⚠️  BigQuery         degraded  (timeout)
  ── Última análise:  há 3min  ·  Jobs em fila: 0
  ```
- Cada subsystem em `🟢 / 🟡 / 🔴`.
- Footer: versão do app (env `NEXT_PUBLIC_APP_VERSION`), link para `/como-funciona`.
- Link discreto no footer principal: `Status do sistema`.

---

## 34. Webhook de entrada — integração com n8n/Zapier/Make

**Caso de uso:** Time de operações tem automação que monitora portais e quer empurrar editais diretamente para o sistema sem UI.

**Solução:**
- Endpoint `POST /webhooks/ingest` com `Authorization: Bearer {LICI_WEBHOOK_SECRET}`.
- Body:
  ```jsonc
  {
    "pdf_url": "https://...",        // OU
    "drive_file_id": "1AbC...",      // OU
    "pdf_base64": "JVBEFi...",
    "orgao": "PRODESP",
    "uf": "SP",
    "vendedor_email": "joao@xertica.com"
  }
  ```
- Reutiliza `_run_pipeline` na rota certa.
- Response: `{ "analysis_id": "...", "status": "queued" }`.
- Secret em `LICI_WEBHOOK_SECRET` (env var). Rotacionável sem deploy.
- Rate limit específico: 60/hora por usuário.
- Log especial `webhook.ingest` para rastreabilidade.

---

## 35. Notas rápidas inline no card do Kanban

**Caso de uso:** Vendedor quer anotar "Ligar para o contato do órgão 3ª feira" sem abrir o detalhe completo.

**Solução:**
- Ícone `✎` discreto no rodapé do card (aparece no hover, ao lado do trash).
- Click → abre popover pequeno com textarea (máx 200 chars) + botão Salvar.
- `POST /editais/{id}/comentarios { texto, autor_email }` (endpoint já existe).
- Card exibe count de comentários: `💬 2` se houver. Click vai para a timeline do detalhe scrollada até os comentários.
- Sem necessidade de abrir nova janela.

---

## 36. Colaboração via Comentários + Gateway de E-mail (Apps Script)

> REVISÃO 4 — Torna a ferramenta um **hub de trabalho** do time, não só um processador de PDFs.

### 36.1 Princípio arquitetural

```
Frontend (Next.js)
    │  lê/escreve comentários
    ▼
PostgreSQL  ←── único source of truth da conversa (performance instantânea)
    │
FastAPI (BackgroundTask)
    │  dispara webhook assíncrono (não trava o response do usuário)
    ▼
Google Apps Script Web App
    │  recebe POST com payload do e-mail
    ▼
GmailApp.sendEmail(...)  ←── usa infraestrutura Google Workspace, zero custo
```

**Por quê não falar direto do frontend com o Apps Script?**
Segurança: a URL do Web App ficaria exposta no bundle JS. Qualquer pessoa poderia enviar e-mails como se fosse o sistema.

**Por quê não salvar em Sheets?**
Performance: leitura/escrita de comentários na UI seria lenta e sem transações. Postgres já está presente, é o lugar certo.

---

### 36.2 Backend — tabela `comentarios` em Postgres

`pg_tools.py` já tem a função `add_comentario` e `list_comentarios` presentes, usadas pela timeline. Confirmar que a tabela inclui todos os campos necessários:

```sql
CREATE TABLE IF NOT EXISTS comentarios (
  id          BIGSERIAL PRIMARY KEY,
  edital_id   BIGINT      NOT NULL REFERENCES editais(id) ON DELETE CASCADE,
  usuario     TEXT        NOT NULL,   -- email do usuário logado
  texto       TEXT        NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON comentarios(edital_id, criado_em DESC);
```

Garantir que `ensure_schema()` inclui este DDL (idempotente com `IF NOT EXISTS`).

---

### 36.3 Backend — novos endpoints FastAPI

**`POST /editais/{id}/comentarios`**
```python
@router.post("/editais/{edital_id}/comentarios", status_code=201)
async def add_comment(
    edital_id: int,
    body: CommentIn,           # { texto: str }
    background_tasks: BackgroundTasks,
    x_user_email: str = Header(...),
):
    comment = await pg_tools.add_comentario(edital_id, x_user_email, body.texto)
    background_tasks.add_task(
        _notify_comment, edital_id, x_user_email, body.texto, comment["id"]
    )
    return comment
```

**`GET /editais/{id}/comentarios`**
```python
@router.get("/editais/{edital_id}/comentarios")
async def list_comments(edital_id: int):
    return await pg_tools.list_comentarios(edital_id)
```

**Background task `_notify_comment`** (não bloqueia o response):
```python
async def _notify_comment(edital_id, autor_email, texto, comment_id):
    apps_script_url = os.getenv("LICI_APPS_SCRIPT_WEBHOOK_URL")
    if not apps_script_url:
        return                           # feature flag: se não configurado, silencia
    
    edital = await pg_tools.get_edital(edital_id)
    recipients = await pg_tools.list_unique_comentadores(edital_id, excluir=autor_email)
    # Também notifica o "dono" do edital (vendedor_email) se diferente
    if edital.get("vendedor_email") and edital["vendedor_email"] != autor_email:
        recipients.add(edital["vendedor_email"])
    
    if not recipients:
        return
    
    payload = {
        "to":         ", ".join(recipients),
        "subject":    f"[Lici] Novo comentário — {edital['orgao']}",
        "user":       autor_email.split("@")[0],
        "editalName": edital["orgao"],
        "comment":    texto[:300],       # trunca para o e-mail (link leva ao full)
        "link":       f"{os.getenv('LICI_BASE_URL')}/edital/{edital_id}#comentarios",
    }
    
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(apps_script_url, json=payload)
        resp.raise_for_status()
```

**Variáveis de ambiente necessárias:**
```
LICI_APPS_SCRIPT_WEBHOOK_URL=https://script.google.com/macros/s/AKfyc.../exec
LICI_BASE_URL=https://x-lici-web-xxx-uc.a.run.app
```

Se `LICI_APPS_SCRIPT_WEBHOOK_URL` não estiver definida, o sistema funciona normalmente (sem e-mails) — sem crash, sem logs de erro.

---

### 36.4 Google Apps Script — código completo do Web App

Colar no editor em `script.google.com`, publicar como **Web App** (Execute as: Me, Who has access: Anyone):

```javascript
// ⚠️ SECURITY: verificar token antes de qualquer operação
const WEBHOOK_SECRET = PropertiesService.getScriptProperties().getProperty("LICI_WEBHOOK_SECRET");

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Valida secret — rejeita se não bater
    if (!WEBHOOK_SECRET || payload.secret !== WEBHOOK_SECRET) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "forbidden" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const { to, subject, user, editalName, comment, link } = payload;

    const logoUrl =
      "https://storage.googleapis.com/etp-bucket/Logos%20Xertica.ai%20(.png)" +
      "/xertica.ai/Copy%20of%20Logo_XERTICA_Black.png";

    const htmlBody = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;background:#03070d;
                  padding:32px;max-width:600px;border-radius:12px;">
        <img src="${logoUrl}" width="140" style="margin-bottom:24px;" />

        <h2 style="color:#e8eaf0;font-size:20px;margin:0 0 8px;">
          Novo comentário — ${editalName}
        </h2>

        <p style="color:#9aa3b2;font-size:14px;margin:0 0 16px;">
          <strong style="color:#00f0ff;">${user}</strong> comentou:
        </p>

        <blockquote style="border-left:4px solid #00f0ff;margin:0 0 24px;
                           padding:12px 16px;background:rgba(0,240,255,0.06);
                           border-radius:0 8px 8px 0;">
          <p style="color:#c8d0de;font-size:15px;margin:0;line-height:1.6;">
            ${comment}
          </p>
        </blockquote>

        <a href="${link}"
           style="display:inline-block;padding:12px 24px;
                  background:linear-gradient(135deg,#00f0ff,#00a8b5);
                  color:#03070d;text-decoration:none;border-radius:8px;
                  font-weight:700;font-size:14px;letter-spacing:0.5px;">
          Responder no Pipeline →
        </a>

        <hr style="border:none;border-top:1px solid #1e2535;margin:32px 0 16px;" />
        <p style="color:#4a5568;font-size:12px;margin:0;">
          Você recebeu este e-mail porque participa de uma discussão no Lici-ADK.<br/>
          Para não receber mais notificações deste edital, acesse o link acima e
          ajuste suas preferências.
        </p>
      </div>
    `;

    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: htmlBody,
      name: "Lici · Xertica",
    });

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error("doPost error:", error);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Health check — GET para testar se o script está vivo
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", service: "lici-mail-gateway" }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**Passos de configuração (execução única):**
1. `script.google.com` → Novo projeto → colar código acima.
2. Renomear projeto: `lici-mail-gateway`.
3. **Projeto → Configurações → Propriedades do script** → adicionar propriedade `LICI_WEBHOOK_SECRET` com um token aleatório (ex: `openssl rand -hex 24`).
4. **Implantar → Nova implantação** → Tipo: Web app → Executar como: **Eu** → Quem tem acesso: **Qualquer pessoa** → Implantar.
5. Copiar URL gerada (formato `https://script.google.com/macros/s/AKfyc.../exec`).
6. Setar no Cloud Run:
   ```
   gcloud run services update x-lici-bff \
     --set-env-vars LICI_APPS_SCRIPT_WEBHOOK_URL=<url>,LICI_APPS_SCRIPT_SECRET=<mesmo-token> \
     --region us-central1
   ```
7. Teste rápido: `curl -X POST <url> -H "Content-Type: application/json" -d '{"secret":"<token>","to":"seu@email","subject":"Teste","user":"dev","editalName":"PRODESP-001","comment":"Funciona!","link":"https://google.com"}'`.

> **⚠️ Quota GmailApp:** contas Google Workspace têm limite de **1.500 e-mails/dia**. Com o modelo de opt-in implícito (notifica apenas participantes do edital), é praticamente impossível atingir esse limite com um time de vendas normal. Se o produto escalar para multi-tenant com muitos usuários simultâneos, migrar para SendGrid (`pip install sendgrid`) requer apenas substituir `_notify_comment` — a arquitetura de background task permanece idêntica.

---

### 36.5 Frontend — contador de comentários no card Kanban

No card do pipeline (`page.tsx`), rodapé:

```tsx
{/* Contador de comentários */}
{edital.comentarios_count > 0 && (
  <button
    onClick={(e) => { e.stopPropagation(); router.push(`/edital/${edital.id}#comentarios`) }}
    className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition-colors"
  >
    <MessageCircle size={12} />
    <span>{edital.comentarios_count}</span>
  </button>
)}
```

`comentarios_count` vem de um `COUNT` no join da query principal de editais — sem round-trip extra:
```sql
SELECT e.*, COUNT(c.id) AS comentarios_count
FROM editais e
LEFT JOIN comentarios c ON c.edital_id = e.id
GROUP BY e.id
```

---

### 36.6 Frontend — seção de comentários no detalhe `/edital/[id]`

Âncora `id="comentarios"` para deep-link do e-mail funcionar.

Layout: expansível no final da página, abaixo da análise. Segue o mesmo espaço visual que a timeline (§27):

```
💬 Comentários (3)
─────────────────────────────────────────────────
  [Avatar] joao@xertica.com · há 2h
           "Acho que temos o atestado da PRODESP para cobrir o gap de volume."

  [Avatar] maria@xertica.com · há 45min
           "Confirmado, já pedi para o time de docs."

─────────────────────────────────────────────────
  [                         Adicionar comentário...                    ] [Enviar →]
```

- Avatar: iniciais coloridas (fundo `--x-cyan` ou `--x-green` por email hash).
- Datas: `formatDistanceToNow` (pt-BR).
- Envio: `Ctrl+Enter` além do botão.
- Otimistic UI: comentário aparece imediatamente na lista antes do response do servidor (reverte se erro).
- Toast de confirmação: `"Comentário enviado. Participantes notificados por e-mail."` (apenas se `NOTIFY_EMAIL` ativo).

---

### 36.7 Quem recebe o e-mail (regra de notificação)

| Evento | Destinatários |
|---|---|
| Novo comentário em edital | Todos que já comentaram no edital + `vendedor_email`, exceto o autor do comentário |
| Análise concluída (§30) | `vendedor_email` do edital |
| Edital movido de fase (futuro) | `vendedor_email` + gerente se configurado |

Sem "subscribe todos do workspace" — menos ruído. Modelo de opt-in implícito: você começa a receber quando participa.

---

## 37. Revisão final do roadmap (Revisão 4)

Itens novos absorvidos no roadmap existente por fase:

| Fase | Conteúdo atualizado |
|---|---|
| **A — Backend** | +`comentarios` DDL em `ensure_schema()` (§36.2), +endpoints comentários (§36.3), +`_notify_comment` background task (§36.3), +Detecção duplicata sha256 (§23), +from-url (§25), +bulk_update (§31), +webhook ingest (§34), +notifications table (§30), +pdf storage GCS (§26) |
| **B — CSS** | sem novos |
| **C — Componentes** | +`CommentSection` (§36.6), +StatusDot (§11.3), +NotificationsDropdown (§30), +TimelineBlock (§27) |
| **D — Pipeline** | +`comentarios_count` no card (§36.5), +BulkEdit actions (§31), +notas rápidas inline (§35) |
| **E — Páginas** | +Seção comentários em `/edital/[id]` (§36.6), +`/status` (§33), +PDF preview drawer (§26), +Score breakdown (§22), +Stage gates UI (§24), +Histórico órgão (§28), +Timeline visual (§27), +Export PDF (§32) |
| **F — Inovação 1** | +Chat SSE streaming (§21) |
| **G — Colaboração e Alertas** | Apps Script gateway (§36.4), notificações in-app (§30), email análise concluída (§30), CI/CD GitHub Actions (§29) |
| **H — Polimento** | RBAC, audit, testes, tour guiado |

---

## 38. Top-16 definitivo (após Revisão 4)

| # | Feature | Seção | Motivo |
|---|---|---|---|
| 1 | Persistência `_JOBS` Postgres | §2.5 | Risco crítico, sem isso escalar quebra |
| 2 | Drive endpoints + drop-zone | §2.1–2.3 | Ingestão sem fricção = uso diário |
| 3 | Detecção duplicata SHA256 | §23 | Custo e dados limpos |
| 4 | Brandbook polish + tipografia | §B | Resolve "feio" imediatamente |
| 5 | Drag-drop + micro-animações | §3.2.3 | UX que impressiona em demo |
| 6 | Busca + filtros chips | §3.2.1 | Sem isso 50 cards = inutilizável |
| 7 | Score breakdown interativo | §22 | Transforma número em decisão |
| 8 | Stage gates UI | §24 | Backend existe, só falta expor |
| 9 | **Comentários + e-mail Apps Script** | **§36** | **Transforma em hub de trabalho do time** |
| 10 | Timeline visual do edital | §27 | Backend existe, colaboração visível |
| 11 | Chat SSE streaming | §21 | Percepção de IA premium |
| 12 | Callout SA email (Drive) | §3.3 | Remove blocker de adoção |
| 13 | Notificações in-app | §30 | Fecha o loop assíncrono sem e-mail |
| 14 | Import from URL pública | §25 | Workflows de portais reais |
| 15 | Bulk edit (não só delete) | §31 | Operações em lote = produtividade |
| 16 | CI/CD GitHub Actions | §29 | Ops confiável, sem deploy manual |

---

## 39. Plano de execução por lotes

**✅ Lote 1 — Confiabilidade + Ingestão (CONCLUÍDO — 02 Mai 2026)**
- ✅ A0: `analysis_jobs` DDL + migração `_JOBS` → Postgres (`pg_tools.py` + `main.py`)
- ✅ A1: SHA256 dedup em `POST /analyze` e `POST /analyze/from-drive`
- ✅ A2: `POST /analyze/from-drive` + `POST /analyze/from-drive-folder`
- ✅ A3: `_notify_comment` background task (webhook → Apps Script, feature-flagged)
- ✅ A4: `GET /editais/{id}/historico-orgao` + `POST /editais/bulk_update`
- ✅ Fix: `text` import sqlalchemy, null guard job reconstruction, drop `_JOBS` fallback get_edital, `upload_edital_in_chat` migrado

**✅ Lote 2 — Visual + Nav (CONCLUÍDO — 02 Mai 2026)**
- ✅ B1: `NavLinks` client component + `layout.tsx` (h-16, nav sem Upload/Admin/Config, avatar branco, header blur)
- ✅ B2: `globals.css` polish — `.heading-xl`, `.skeleton`, `.dropzone`, `.nav-active`, `.tabs-pill`, `.btn-primary` gradient, dnd styles, orb/grid bump
- ✅ B3: `/como-funciona` page — 4 agent cards, data sources, CTA
- ✅ B4: Pipeline hero — `heading-xl`, search bar collapsível, chips UF/P1-P3, `filteredEditais` useMemo

**✅ Lote 3 — Pipeline UX / parcial (CONCLUÍDO — 02 Mai 2026)**
- ✅ C2: Searchbar + filtros chips (feito como parte do B4)
- ✅ C3: `@dnd-kit` instalado, `KanbanColumn` com `useDroppable`, `DragOverlay` rotate+glow, haptic
- ❌ C1: `comentarios_count` badge nos cards (backend JOIN + frontend) — **PENDENTE**
- ❌ C4: Bulk edit (atribuir vendedor, mudar prioridade, mover fase) — **PENDENTE**

**✅ Lote 4 — Upload revisado (CONCLUÍDO — 02 Mai 2026)**
- ✅ D1: 3 abas (Arquivo PDF / Google Drive / Pasta do Drive) + `SACallout` com copy button + tutorial
- ✅ D2: SA email callout integrado nas abas Drive e Pasta (auto-reabre em erro 404)

**🔄 Lote 3 (C1, C4) + Lote 5 — Em execução**
C1 (comentarios_count) + C4 (bulk edit) + E3 (from-url) + E6 (histórico órgão no detalhe)

**Lote 5 — Inovação + Robustez (~2 dias)**
E1 (Chat SSE) + E2 (notif in-app) + E3 (from-url) + E4 (webhook ingest) + E5 (score breakdown v2) + E6 (histórico órgão no detalhe)

**Lote 6 — Polimento final (~1 dia)**
F1 (Export PDF parecer) + F2 (PDF inline preview) + F3 (/status page) + F4 (CI/CD) + F5 (first-time tour) + F6 (RBAC básico)

---

> **Próximo passo:** diz `vai lote 1` para iniciar a execução.  
> Quando chegarmos no **Lote 3**, você só precisa colar o código do §36.4 no Apps Script e me passar a URL — o resto é automático.

---

# REVISÃO 5 — Auditoria Real do Código vs. Plano

> Leitura completa de `backend/main.py`, `backend/tools/pg_tools.py`, `web/src/app/edital/[id]/page.tsx`, `web/src/app/upload/page.tsx`, `web/src/app/page.tsx` e `web/src/app/layout.tsx`. O objetivo é alinhar o plano com o que **realmente existe** — para não redesenhar algo que já está pronto e não deixar nenhum GAP real sem cuidado.

---

## 39. O que o backend JÁ TEM (e o plano não percebeu)

O backend está muito mais avançado do que o plano assumia. Veja o que já existe:

### 39.1 Tabelas Postgres — TODAS já criadas em `ensure_schema()`

| Tabela | Status no plano | Status real |
|---|---|---|
| `editais` | ✅ prevista | ✅ existe, com todas as colunas |
| `edital_movimentacoes` | ✅ prevista | ✅ existe |
| `edital_comentarios` | §36 propôs criar | ✅ **já existe** com `mencionados TEXT[]` |
| `edital_gates` | §24 previu criar | ✅ **já existe** com `UNIQUE(edital_id, stage, gate_key)` |
| `usuarios` | §14 previu | ✅ **já existe** |
| `chat_sessions` | §6 previu criar | ✅ **já existe** |
| `chat_messages` | §6 previu criar | ✅ **já existe** com `attachments_meta JSONB` |
| `atestados_cache` | fase 4 | ✅ existe |
| `analysis_jobs` | §2.5 propôs criar | ❌ **NÃO EXISTE** — `_JOBS` ainda é in-memory |

**Conclusão crítica:** a única tabela que falta criar é `analysis_jobs` para substituir `_JOBS`. Todo o resto do schema já está em produção.

### 39.2 Endpoints FastAPI — O QUE JÁ EXISTE

| Endpoint | Plano assumia criar | Status real |
|---|---|---|
| `POST /editais/{id}/comentarios` | §36.3 propôs criar | ✅ **já existe** |
| `GET /editais/{id}/comentarios` | §36.3 propôs criar | ✅ **já existe** |
| `GET /editais/{id}/gates` | §24 propôs criar | ✅ **já existe** |
| `PATCH /editais/{id}/gates/{key}` | §24 propôs criar | ✅ **já existe** |
| `PATCH /editais/{id}` | §3 previu | ✅ existe, move fase + seed gates + registra movimentação automaticamente |
| `GET /editais/{id}` | previsto | ✅ existe, retorna `comentarios + gates + movimentacoes` num único response |
| `POST /editais/bulk_delete` | previsto | ✅ existe |
| `POST /editais/{id}/analise_juridica` | previsto | ✅ existe com fallback de reconstrução do job via Postgres |
| `GET /editais/{id}/analise_juridica` | previsto | ✅ existe com reconstrução de job após restart |
| `GET /editais/{id}/kit_habilitacao` | previsto | ✅ existe |
| `GET /editais/{id}/documentos` | previsto | ✅ existe, lista minutas + declarações |
| `GET /editais/{id}/documentos/{tipo}` | previsto | ✅ existe (impugnacao, esclarecimento, kit, declaracoes) |
| `POST /internal/drive/rescan` | previsto | ✅ existe |
| `GET /chat/sessions` | previsto | ✅ existe |
| `POST /chat/sessions/{id}/upload_edital` | previsto | ✅ existe — chat aceita PDF! |
| `POST /analyze/from-drive` | §2.1 propôs criar | ❌ **NÃO EXISTE** |
| `POST /analyze/from-drive-folder` | §2.2 propôs criar | ❌ **NÃO EXISTE** |
| `POST /analyze/from-url` | §25 propôs criar | ❌ **NÃO EXISTE** |
| `POST /editais/bulk_update` | §31 propôs criar | ❌ **NÃO EXISTE** |
| `GET /editais/{id}/historico-orgao` | §28 propôs criar | ❌ **NÃO EXISTE** |
| `POST /webhooks/ingest` | §34 propôs criar | ❌ **NÃO EXISTE** |
| `GET /notifications` | §30 propôs criar | ❌ **NÃO EXISTE** |

### 39.3 Lógica de negócio já implementada (surpresas boas)

- **`STAGE_GATES`** em `pg_tools.py` já define os checklist gates para todos os 8 stages.
- **`seed_gates()`** já existe — chamado automaticamente quando fase muda.
- **Reconstrução de job após restart:** `POST /editais/{id}/analise_juridica` já busca o `edital_json_storage` do Postgres e reconstrói o `JobState` se o container reiniciou. É um workaround inteligente para o problema do `_JOBS` in-memory que o plano descreveu como "Achilles heel" — já está parcialmente mitigado.
- **`result_json`** e **`relatorio_juridico_json`** já são persistidos no Postgres após cada análise. Isso significa que os dados **sobrevivem a restarts** — o risco do `_JOBS` é real mas menor do que o plano sugeria.
- **`mencionados TEXT[]`** na tabela de comentários — o backend já suporta @menções, a UI só não expõe isso ainda.

---

## 40. O que o frontend `/edital/[id]` JÁ TEM (e o plano não percebeu)

### 40.1 Já implementado na página de detalhe

Após ler o arquivo completo, estas features do plano **já existem no frontend**:

| Feature do plano | Status real |
|---|---|
| Score breakdown com evidências por requisito | ✅ **já existe** — `AtestadosSection` renderiza `EvidCard` por requisito com valor, confiança, link Drive, trecho literal |
| Somatório cascata (volumes nacionais/internacionais) | ✅ **já existe** — `CascataCard` com contributors, deltaFaltante, níveis |
| Kit de habilitação (atestados recomendados + certidões) | ✅ **já existe** |
| Stage gates UI com checklist | ✅ **já existe** — renderiza gates com checkbox interativo e PATCH |
| Timeline de movimentações | ✅ **já existe** — seção "Histórico de movimentações" com dots coloridos |
| Comentários (lista + input) | ✅ **já existe** — seção completa com form de envio |
| Documentos gerados (impugnação, esclarecimento, declarações) | ✅ **já existe** |
| Análise jurídica on-demand com polling | ✅ **já existe** |
| Botões de mover fase | ✅ **já existe** |

**Conclusão:** §22 (score breakdown), §24 (stage gates), §27 (timeline), §36 (comentários) — o plano propôs criar coisas que **já existem**.

### 40.2 O que ainda falta no frontend `/edital/[id]`

- **Score breakdown como "Por que X%?" interativo** — o que existe é uma listagem de evidências técnicas. O que o §22 propõe (linha de totais, "máximo alcançável", botão "Solicitar atestado") é mais rico e não existe.
- **Histórico do órgão** (§28) — não existe. Backend não tem o endpoint ainda.
- **Export PDF do parecer** (§32) — não existe.
- **PDF inline preview** (§26) — não existe.
- **@menções na textarea de comentários** — a coluna existe no banco, a UI não expõe.

### 40.3 Upload page — estado real

O que existe:
- ✅ Drop zone drag-and-drop funcional
- ✅ Metadados opcionais (órgão, UF, vendedor, drive folder ID)
- ✅ Progress bar 3 steps (Extração → Qualificação → Análise)
- ✅ Polling via `GET /editais/{analysis_id}` com redirect para pg_edital_id

O que **falta** conforme o plano:
- ❌ Aba "Google Drive" (single file via file ID)
- ❌ Aba "Pasta do Drive" (bulk import)
- ❌ Aba "URL pública" (Comprasnet, PNCP)
- ❌ SA email callout com copy button

### 40.4 Pipeline page (`page.tsx`) — estado real

O que existe:
- ✅ Kanban com 8 colunas
- ✅ Cards com score badge, prioridade badge, move arrows (← →)
- ✅ Bulk select com Escape para limpar
- ✅ Bulk delete com confirmação
- ✅ Toast notifications

O que **falta**:
- ❌ `comentarios_count` badge no card (dados não vêm no `GET /editais`)
- ❌ Drag-and-drop @dnd-kit
- ❌ Searchbar + filtros chips
- ❌ Coluna "Novo" drop-zone
- ❌ Bulk edit (atribuir vendedor, mudar prioridade, mover fase)

### 40.5 Layout / Nav — estado real

O que existe:
- ✅ Brandbook tokens no `globals.css`
- ✅ bg-grid, bg-orbs, noise-overlay
- ✅ Logo Xertica white
- ✅ Avatar X vermelho
- ✅ `ChatWidget` integrado

O que **falta**:
- ❌ Nav ainda tem Upload, Config, Admin — deveriam ser removidos
- ❌ Sem "Como funciona" no nav
- ❌ Header ainda `h-14` (plano quer `h-16`)
- ❌ Nav link ativo não tem highlight visual
- ❌ Notificações sino não existe

---

## 41. Gap analysis consolidado — O QUE REALMENTE FALTA CONSTRUIR

Com base na auditoria real, o backlog real priorizado:

### BACKEND (o que falta construir do zero)

**Alta prioridade:**
1. `analysis_jobs` tabela + migrar `_JOBS` → Postgres (§2.5) — risco de escala
2. `POST /analyze/from-drive` — download por file ID (§2.1)
3. `POST /analyze/from-drive-folder` — bulk import de pasta (§2.2)
4. `_notify_comment` background task + `LICI_APPS_SCRIPT_WEBHOOK_URL` (§36.3) — a tabela e endpoints de comentários **já existem**, só falta o webhook de notificação
5. `GET /editais/{id}/historico-orgao` (§28)
6. `POST /editais/bulk_update` — atribuir vendedor/prioridade em lote (§31)

**Média prioridade:**
7. `POST /analyze/from-url` — import por URL pública (§25)
8. `POST /webhooks/ingest` — entrada para n8n/Zapier (§34)
9. SHA256 dedup check em `POST /analyze` (§23)
10. `GET /editais/{id}/parecer.pdf` via WeasyPrint (§32)
11. `GET /notifications` + tabela `notifications` (§30)

**Baixa prioridade:**
12. SSE streaming `/chat/stream` (§21)
13. CI/CD GitHub Actions (§29)

### FRONTEND (o que falta construir do zero)

**Alta prioridade:**
1. Upload: 3 abas (PDF / Drive / URL) + SA email callout
2. Pipeline: `comentarios_count` badge nos cards (precisa de query com `COUNT(c.id)`)
3. Pipeline: Searchbar + filtros chips (órgão, UF, vendedor, prioridade)
4. Pipeline: Drag-and-drop @dnd-kit com micro-animações
5. Nav cleanup: remover Upload/Config/Admin; manter Pipeline/Histórico/Chat IA/Como funciona
6. `NotificationsDropdown` no header (sino)

**Média prioridade:**
7. Pipeline: Bulk edit (menu "Mais ações" com atribuir vendedor, mudar prioridade, mover fase)
8. `/edital/[id]`: Score breakdown melhorado (§22 — "máximo alcançável", botão "Solicitar atestado")
9. `/edital/[id]`: Histórico do órgão (§28)
10. `/edital/[id]`: PDF inline preview drawer (§26)
11. `/edital/[id]`: @menções na textarea de comentários (§36.6)
12. Pages: `/como-funciona`, `/status`

**Baixa prioridade:**
13. Export PDF parecer (§32)
14. First-time tour (§17)
15. RBAC UI (§14)

### FEATURES RISCADAS DO BACKLOG (já prontas!)

Estas seções do plano podem ser marcadas como ✅ DONE e retiradas do executor:

- §22 score breakdown → já existe como `AtestadosSection` + `CascataCard`. Só enriquecer.
- §24 stage gates UI → já existe no `/edital/[id]`. Não precisa criar.
- §27 timeline visual → já existe no `/edital/[id]`. Não precisa criar.
- §36 comentários UI → já existe no `/edital/[id]`. Só adicionar notificação por e-mail.
- §30 email análise concluída → a **infra** já existe (comentários, movimentações). Só falta o background task `_notify_comment`.

---

## 42. Plano de execução revisado (baseado na realidade)

### Lote 1 — Confiabilidade + Drive (~1.5 dias)

> Backend puro. Zero mudança no frontend.

**A0: Migração `_JOBS` → Postgres**
- Criar tabela `analysis_jobs` em `ensure_schema()`
- Substituir `_JOBS: dict` por funções `get_job / set_job / touch_job` via Postgres
- `mark_orphan_jobs_failed()` no startup
- Remover comentário `max-instances=1` do deploy

**A1: Dedup SHA256**
- Coluna `pdf_sha256 TEXT` em `analysis_jobs`
- Check no `POST /analyze`

**A2: Drive endpoints**
- `POST /analyze/from-drive` reutilizando `_extrair_pdf()` de `drive_tools.py`
- `POST /analyze/from-drive-folder` reutilizando `_list_pdfs()`
- Resposta: `{analysis_ids: [...], queued: n}` para bulk

**A3: `_notify_comment` background task**
- A tabela e os endpoints já existem. Só adicionar o webhook call após `add_comentario`.
- Setar `LICI_APPS_SCRIPT_WEBHOOK_URL` no Cloud Run após URL do Apps Script estar pronta.

**A4: `historico-orgao` + `bulk_update`**
- `GET /editais/{id}/historico-orgao` — query simples por órgão
- `POST /editais/bulk_update` — PATCH em lote com whitelist de campos

---

### Lote 2 — Visual + Nav (~1 dia)

> CSS + layout. Zero mudança no backend.

**B1: Nav cleanup**
- Remover Upload, Config, Admin do nav
- Adicionar "Como funciona" → `/como-funciona`
- `h-14` → `h-16`
- Active link highlight (usando `usePathname`)

**B2: Tipografia e polish geral**
- H1 `text-2xl` → `text-4xl/5xl` no pipeline
- `.heading-xl`, `.skeleton`, `.dropzone` no `globals.css`
- Opacidade dos orbs e bg-grid levemente aumentada

**B3: `como-funciona` page**
- Página estática explicando o fluxo em 4 steps com ícones brandbook

---

### Lote 3 — Pipeline UX (~1.5 dias)

> Pipeline é a página mais usada. Merece dedicação exclusiva.

**C1: `comentarios_count` no card**
- Backend: `list_editais` precisa fazer `LEFT JOIN edital_comentarios c ON c.edital_id = e.edital_id GROUP BY e.edital_id` e retornar `comentarios_count`
- Frontend: ícone `💬 2` no rodapé do card, clica vai para `/edital/{id}#comentarios`

**C2: Searchbar + filtros chips**
- Input de texto filtra `orgao/objeto` client-side (sem round-trip)
- Chips: UF, Prioridade P1-P5, Vendedor
- Estado na URL via `useSearchParams` (links compartilháveis)

**C3: Drag-and-drop @dnd-kit**
- `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- DndContext + Droppable por coluna
- Drag overlay: `rotate(3deg) scale(1.04)` + glow `--x-cyan`
- On drop: `PATCH /editais/{id}` com nova `fase_atual`

**C4: Bulk edit**
- Menu "⋯ Mais ações" no `BulkActionBar`
- Atribuir vendedor, mudar prioridade, mover fase → `POST /editais/bulk_update`

---

### Lote 4 — Upload revisado (~0.5 dia)

> Upload já funciona. Só adicionar Drive + SA callout.

**D1: 3 abas**
- Tab "Arquivo PDF" → fluxo atual
- Tab "Google Drive" → input de file ID ou URL do Drive → `POST /analyze/from-drive`
- Tab "Pasta do Drive" → input de folder ID → `POST /analyze/from-drive-folder`

**D2: SA email callout**
- Banner no topo de ambas as abas Drive
- SA email copiável: `lici-adk-sa@operaciones-br.iam.gserviceaccount.com`
- 3 passos visuais: "1 → Acesse o Drive → 2 → Compartilhe com o SA → 3 → Cole o ID"

---

### Lote 5 — Inovação + Robustez (~2 dias)

**E1: Chat SSE streaming** (§21) — ao fazer deploy desta fase, adicionar header `X-Accel-Buffering: no` e usar `StreamingResponse` sem buffer; Cloud Run por padrão respeita isso, mas verificar se proxy nginx intermediário está desabilitado.
**E2: Notificações in-app** (§30) — sino no header, tabela `notifications`
**E3: Import from-url** (§25) — Comprasnet, PNCP, BEC-SP
**E4: Webhook de entrada** (§34) — para n8n/Zapier
**E5: Score breakdown enriquecido** (§22) — "máximo alcançável" + botão "Solicitar atestado"
**E6: Histórico do órgão** no `/edital/[id]` (§28)

---

### Lote 6 — Polimento final (~1 dia)

**F1: Export PDF do parecer** via WeasyPrint (§32)
**F2: PDF inline preview** via GCS signed URL (§26)
**F3: `/status` page** (§33)
**F4: CI/CD GitHub Actions** (§29)
**F5: First-time tour** (§17)
**F6: RBAC básico** (§14)

---

## 43. Cronograma final realista

| Lote | Conteúdo | Estimativa | Dependências |
|---|---|---|---|
| 1 | `_JOBS` → Postgres + Drive endpoints + notify_comment | ~1.5 dias | — |
| 2 | Visual + Nav + `como-funciona` | ~1 dia | — (paralelo ao Lote 1) |
| 3 | Pipeline UX (dnd-kit + search + bulk edit + count) | ~1.5 dias | Lote 1 (bulk_update) |
| 4 | Upload 3 abas + SA callout | ~0.5 dia | Lote 1 (Drive endpoints) |
| 5 | Inovações (SSE, notif, from-url, webhook, score v2) | ~2 dias | Lote 1 completo |
| 6 | Polimento (PDF export, preview, status, CI/CD, tour) | ~1 dia | Lotes anteriores |

**Total: ~7.5 dias de desenvolvimento sequencial. Com paralelismo Lotes 1+2: ~6.5 dias.**

---

## 44. Apps Script — posição correta no plano

O gateway de e-mail (§36.4) **não bloqueia nenhum lote**. A notificação é totalmente feature-flagged via `LICI_APPS_SCRIPT_WEBHOOK_URL`. O código do backend pode ser escrito no Lote 1 e funciona sem o script — quando você criar o Apps Script e me passar a URL, basta setar uma variável de ambiente no Cloud Run, sem novo deploy de código.

**Checklist de configuração do Apps Script (execução única, feita por você):**
1. `script.google.com` → Novo projeto → colar código do §36.4
2. Implantar como Web App (Executar como: Eu / Acesso: Qualquer pessoa)
3. Copiar URL `https://script.google.com/macros/s/AKfyc.../exec`
4. `gcloud run services update x-lici-bff --set-env-vars LICI_APPS_SCRIPT_WEBHOOK_URL=<url> --region us-central1`

Sem deploy. Sem código novo. E-mails começam a chegar na hora.

---

> **Plano fechado. Auditado contra o código real.**  
> Diz `vai lote 1` para começar a execução.
