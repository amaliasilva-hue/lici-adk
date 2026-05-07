# xerticaproc — Arquitetura Completa

**Versão:** 1.0 | **Atualizado:** 2026-05-07 | **Projeto GCP:** `operaciones-br`

---

## Índice

1. [Contexto e Posicionamento](#1-contexto-e-posicionamento)
2. [Visão de Alto Nível](#2-visão-de-alto-nível)
3. [Arquitetura GCP — Diagrama Completo](#3-arquitetura-gcp--diagrama-completo)
4. [Camada Frontend (xerticaproc-web)](#4-camada-frontend-xerticaproc-web)
5. [Camada Backend (xerticaproc-api)](#5-camada-backend-xerticaproc-api)
6. [Pipeline de Agentes IA](#6-pipeline-de-agentes-ia)
7. [Pipeline de Pesquisa de Preços](#7-pipeline-de-pesquisa-de-preços)
8. [Connectors para APIs Externas](#8-connectors-para-apis-externas)
9. [Modelo de Dados (AlloyDB)](#9-modelo-de-dados-alloydb)
10. [Schemas Pydantic (contrato de dados)](#10-schemas-pydantic-contrato-de-dados)
11. [Score de Comparabilidade](#11-score-de-comparabilidade)
12. [Guardrails — Regras Hard](#12-guardrails--regras-hard)
13. [Fluxo de Aprovação Humana](#13-fluxo-de-aprovação-humana)
14. [CI/CD com Cloud Build](#14-cicd-com-cloud-build)
15. [Infraestrutura como Código (Terraform)](#15-infraestrutura-como-código-terraform)
16. [Stack GCP Completa](#16-stack-gcp-completa)
17. [Segurança e Conformidade](#17-segurança-e-conformidade)
18. [Observabilidade](#18-observabilidade)
19. [Roadmap de Sprints](#19-roadmap-de-sprints)

---

## 1. Contexto e Posicionamento

### O que é xerticaproc

`xerticaproc` é a plataforma de geração de **ETP (Estudo Técnico Preliminar)** e **TR (Termo de Referência)** para contratações públicas de TIC, conforme:

- **Lei nº 14.133/2021** — Nova Lei de Licitações e Contratos
- **IN SGD/ME nº 94/2022** — Instrução Normativa para contratação de TIC
- **TCU — Súmulas e acórdãos** relevantes à pesquisa de preços

### Diferencial fundamental

> Xerticaproc **não gera texto bonito — gera processo defensável com evidências rastreáveis.**

O sistema é auditável em qualquer momento:
- Por que essa solução foi escolhida?
- Por que esse preço de referência?
- Quais fontes foram usadas ou descartadas, e por quê?
- Quem aprovou, quando, e qual versão do prompt/modelo gerou o resultado?

### Separação de responsabilidades com lici-adk

| Sistema | Pergunta central | Usuário |
|---|---|---|
| **lici-adk** | "A Xertica deve participar neste edital?" | Vendedor / Analista Comercial |
| **xerticaproc** | "Como montar o ETP/TR desta contratação?" | Servidor público / Equipe de compras |

Os dois sistemas **coexistem** no mesmo projeto GCP (`operaciones-br`) e compartilham:
- Vertex AI / Gemini
- AlloyDB PostgreSQL (schemas separados: `lici` vs `xerticaproc`)
- BigQuery (datasets separados)
- Cloud Storage (buckets separados)
- Cloud Run (serviços nomeados independentemente)

---

## 2. Visão de Alto Nível

```
Servidor Público / Equipe TIC
          │
          │ HTTPS + Google OAuth
          ▼
  ┌─────────────────┐
  │ xerticaproc-web │   Next.js 15 · Cloud Run
  │  Wizard ETP/TR  │   SSR + API Routes
  └────────┬────────┘
           │ HTTPS (Google ID-token injetado pelo proxy)
           ▼
  ┌─────────────────┐
  │ xerticaproc-api │   FastAPI · Cloud Run
  │ Pipeline ADK    │   9 agentes em sequência
  └────┬──────┬─────┘
       │      │
  Vertex AI  AlloyDB + pgvector
  Gemini 2.5  BigQuery
              Cloud Storage
              Cloud Tasks
              GCP Workflows
```

---

## 3. Arquitetura GCP — Diagrama Completo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser (servidor público / equipe TIC)                                     │
│  ── Google OAuth (NextAuth) → Google ID token                                │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  xerticaproc-web  (Next.js 15 · Cloud Run · us-central1)                     │
│                                                                               │
│  Wizard:  DFD → Demanda → Mercado → Preços → ETP → TR → Revisão → Export    │
│  /contratacoes/nova          → formulário de entrada                          │
│  /contratacoes/[id]          → painel da contratação + progresso             │
│  /api/proxy/[...path]        → repassa requisições com ID-token Google       │
│  /auth/...                   → NextAuth (Google OAuth)                        │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTPS autenticado (Bearer Google ID-token)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  xerticaproc-api  (FastAPI · Cloud Run · us-central1)                        │
│                                                                               │
│  POST /proc/contratacoes                  → cria contratação                 │
│  GET  /proc/contratacoes                  → lista contratações               │
│  POST /proc/contratacoes/{id}/etapa/{e}   → aciona etapa específica          │
│  POST /proc/contratacoes/{id}/pipeline    → pipeline completo (async job)    │
│  GET  /proc/contratacoes/{id}/status      → polling de status e progresso    │
│  GET  /proc/contratacoes/{id}/bundle      → EvidenceBundle completo          │
│  GET  /proc/contratacoes/{id}/mapa-precos → mapa de preços estruturado       │
│  GET  /proc/contratacoes/{id}/etp         → texto do ETP gerado              │
│  GET  /proc/contratacoes/{id}/tr          → texto do TR gerado               │
│  GET  /proc/healthz                       → health check                      │
│                                                                               │
│  OrchestratorResult (SequentialAgent via ADK):                               │
│                                                                               │
│  ┌────────┐  ┌───────────┐  ┌────────┐  ┌────────┐  ┌────────┐             │
│  │Demanda │→ │Decomposic.│→ │Mercado │→ │Preços  │→ │Técnico │             │
│  └────────┘  └───────────┘  └────────┘  └────────┘  └────────┘             │
│       ↓ (EvidenceBundle se acumula ao longo do pipeline)                     │
│  ┌──────────┐  ┌────────┐  ┌──────────┐  ┌────────┐  ┌────────┐           │
│  │ Jurídico │→ │ Riscos │→ │  Redator │→ │  ETP   │→ │   TR   │           │
│  └──────────┘  └────────┘  └──────────┘  └────────┘  └────────┘           │
│                                     ↓                                        │
│                              ┌───────────┐                                   │
│                              │  Revisor  │                                   │
│                              └───────────┘                                   │
└──────┬───────────────────────────────┬────────────────────┬─────────────────┘
       │ Vertex AI                     │ AlloyDB             │ BigQuery
       ▼                               ▼                     ▼
┌──────────────┐   ┌───────────────────────────────┐  ┌────────────────────┐
│ Gemini 2.5   │   │ AlloyDB Cluster               │  │ BigQuery Dataset   │
│ Flash / Pro  │   │  schema: xerticaproc          │  │  xerticaproc       │
│              │   │  ├─ contratacoes              │  │  ├─ mapa_precos    │
│              │   │  ├─ documentos_gerados        │  │  ├─ fontes_mercado │
│              │   │  ├─ fontes_normativas          │  │  ├─ itens_mercado  │
│              │   │  ├─ fontes_mercado             │  │  ├─ evidencias     │
│              │   │  ├─ itens_mercado              │  │  └─ prompt_exec    │
│              │   │  ├─ decisoes                  │  └────────────────────┘
│              │   │  ├─ riscos                    │
│              │   │  ├─ prompt_execucoes           │
│              │   │  └─ embeddings (pgvector)      │
│              │   └───────────────────────────────┘
│              │
│              │   ┌────────────────┐  ┌────────────────┐
│              │   │ Cloud Tasks    │  │ GCP Workflows  │
│              │   │ (rate limiting │  │ (fluxos longos │
│              │   │  APIs externas)│  │  ETP/TR/Preços)│
│              │   └────────────────┘  └────────────────┘
│              │
│              │   ┌────────────────┐  ┌────────────────┐
│              │   │ Cloud Storage  │  │ Document AI    │
│              │   │ PDFs brutos    │  │ OCR/extração   │
│              │   │ DOCX/PDF/XLSX  │  │ de documentos  │
│              │   └────────────────┘  └────────────────┘
└──────────────┘
```

---

## 4. Camada Frontend (xerticaproc-web)

### Stack

| Componente | Tecnologia |
|---|---|
| Framework | Next.js 15 (App Router, `standalone` output) |
| Auth | NextAuth.js + Google OAuth (restrito a `@xertica.com`) |
| Estilos | Tailwind CSS |
| Runtime | Node.js 20 em Alpine (Dockerfile multistage) |
| Deploy | Cloud Run (us-central1), porta 3000 |

### Rotas principais

```
/                          → dashboard de contratações
/contratacoes/nova         → formulário de nova contratação
/contratacoes/[id]         → painel da contratação (status, wizard, documentos)
/auth/signin               → página de login Google OAuth
/auth/error                → página de erro de autenticação
/api/proxy/[...path]       → proxy autenticado para xerticaproc-api
```

### Proxy autenticado (`/api/proxy/[...path]`)

O frontend **nunca** chama a API diretamente. Todo tráfego passa pelo proxy Next.js, que:
1. Lê o token Google ID da sessão NextAuth
2. Injeta `Authorization: Bearer <google-id-token>` no header
3. Repassa para `NEXT_PUBLIC_API_URL`

Isso garante que a API nunca esteja exposta publicamente sem autenticação.

### Variáveis de ambiente

| Variável | Fonte | Uso |
|---|---|---|
| `NEXTAUTH_URL` | Cloud Run env | URL canônica do serviço |
| `NEXTAUTH_SECRET` | Secret Manager | Assinar sessões JWT |
| `GOOGLE_CLIENT_ID` | Secret Manager | OAuth app ID |
| `GOOGLE_CLIENT_SECRET` | Secret Manager | OAuth app secret |
| `NEXT_PUBLIC_API_URL` | Cloud Run env | URL do xerticaproc-api |

### Wizard de etapas

O frontend guia o usuário através de um wizard linear, mapeado ao status da contratação:

```
rascunho → demanda → mercado → precos → etp → tr → revisao → aprovado
```

Cada etapa corresponde a uma chamada ao endpoint `/proc/contratacoes/{id}/etapa/{etapa}` e o frontend faz polling em `/proc/contratacoes/{id}/status` para exibir progresso.

---

## 5. Camada Backend (xerticaproc-api)

### Stack

| Componente | Tecnologia |
|---|---|
| Framework | FastAPI (async) |
| Python | 3.12 |
| Validação | Pydantic v2 |
| HTTP client | httpx (async) |
| DB driver | asyncpg + AlloyDB |
| IA | vertexai SDK (Gemini) |
| Deploy | Cloud Run (us-central1), porta 8080 |

### Estrutura de diretórios

```
xerticaproc/backend/
├── main.py                   ← FastAPI app, rotas REST, job store em memória (MVP)
├── logging_config.py         ← JSON structured logging para Cloud Logging
├── requirements.txt
├── Dockerfile
├── agents/
│   ├── orchestrator.py       ← OrchestratorResult + executar_pipeline_completo()
│   ├── demanda_agent.py      ← Agente 1: estrutura demanda/DFD
│   ├── decomposicao_agent.py ← Agente 2: decompõe objeto em itens contratáveis
│   ├── mercado_agent.py      ← Agente 3: pesquisa de mercado + matriz alternativas
│   ├── precos_agent.py       ← Agente 4: pipeline de preços (crítico)
│   ├── tecnico_agent.py      ← Agente 5: requisitos técnicos e SLA
│   ├── juridico_agent.py     ← Agente 6: validação normativa (RAG)
│   ├── riscos_agent.py       ← Agente 7: matriz de riscos
│   ├── redator_agent.py      ← Agente 8: redação ETP e TR
│   └── revisor_agent.py      ← Agente 9: auditoria e revisão do documento
├── connectors/
│   ├── pncp_connector.py     ← PNCP API (atas, contratos, itens)
│   └── compras_gov_connector.py ← Compras.gov API (itens homologados)
├── models/
│   └── schemas.py            ← Pydantic models (enums, entidades, bundles)
└── tools/
    ├── comparabilidade.py    ← Score de comparabilidade multidimensional
    ├── normalizacao.py       ← Normalização de itens (unidade, vigência, escala)
    └── pg_tools.py           ← Utilitários AlloyDB/pgvector
```

### Gerenciamento de jobs (MVP → Produção)

No MVP, o estado é mantido em dicionários Python em memória (`_jobs`, `_contratacoes`):
```python
_jobs: dict[str, dict[str, Any]] = {}
_contratacoes: dict[str, dict[str, Any]] = {}
```

Em produção, este estado migra para AlloyDB nas tabelas `contratacoes` e `prompt_execucoes`.

### Cycle de vida de uma contratação (via API)

```
POST /proc/contratacoes
  → status: rascunho, id gerado

POST /proc/contratacoes/{id}/etapa/demanda          (ou /pipeline para tudo)
  → BackgroundTask inicia; status: em_execucao

GET /proc/contratacoes/{id}/status    (polling a cada 2s pelo frontend)
  → { status, etapa_atual, progresso_pct, erros }

GET /proc/contratacoes/{id}/bundle    (quando status = concluido)
  → EvidenceBundle completo com todos os outputs dos agentes

GET /proc/contratacoes/{id}/etp       → texto Markdown do ETP
GET /proc/contratacoes/{id}/tr        → texto Markdown do TR
```

---

## 6. Pipeline de Agentes IA

O orquestrador (`orchestrator.py`) executa os agentes em sequência via `OrchestratorResult`. O `EvidenceBundle` acumula as saídas de cada etapa e é passado para os agentes subsequentes.

### Mapa de agentes

```
EntradaDemanda + documentos PDF
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 1 — Demanda / DFD                                                    │
│  Modelo:   Gemini 2.5 Pro (temperatura 0.2)                                 │
│  Entrada:  EntradaDemanda + PDFs opcionais (DFD, e-mails, atas)            │
│  Saída:    DemandaEstruturada                                                │
│  → problema_publico, objetivo, unidade_demandante, prazo, restrições, PCA  │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 2 — Decomposição do Objeto                                           │
│  Modelo:   Gemini 2.5 Flash                                                 │
│  Entrada:  DemandaEstruturada                                               │
│  Saída:    ObjetoDecomposto                                                  │
│  → lista de itens contratáveis, alertas de direcionamento/exclusividade     │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 3 — Pesquisa de Mercado                                              │
│  Modelo:   Gemini 2.5 Pro + Agent Search (Vertex AI)                        │
│  Entrada:  ObjetoDecomposto                                                  │
│  Saída:    MatrizAlternativas                                                │
│  → soluções A/B/C/D, vantagens, desvantagens, custo estimado, justificativa│
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 4 — Preços  (etapa crítica operacional)                              │
│  Modelo:   Gemini 2.5 Flash + FunctionTools                                 │
│  Tools:    PNCP connector, Compras.gov connector, AlloyDB histórico         │
│  Entrada:  ObjetoDecomposto + filtros de busca                              │
│  Saída:    MapaPrecos                                                        │
│  → fontes aceitas/descartadas, score por item, memória de cálculo           │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 5 — Técnico                                                          │
│  Modelo:   Gemini 2.5 Flash                                                 │
│  Entrada:  DemandaEstruturada + ObjetoDecomposto                            │
│  Saída:    RequisitosTecnicos                                                │
│  → requisitos funcionais, não-funcionais, segurança (LGPD), SLA, métricas  │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 6 — Jurídico / Normativo                                             │
│  Modelo:   Gemini 2.5 Pro + RAG sobre base normativa (pgvector)             │
│  Fonte RAG: Lei 14.133, IN 94/2022, Súmulas TCU, LGPD                      │
│  Entrada:  Outputs acumulados + RequisitosTecnicos                          │
│  Saída:    ValidacaoJuridica                                                 │
│  → aderência normativa, alertas, checklist, pendências legais               │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 7 — Riscos                                                           │
│  Modelo:   Gemini 2.5 Flash                                                 │
│  Entrada:  EvidenceBundle completo até esta etapa                           │
│  Saída:    MatrizRiscos                                                      │
│  → probabilidade, impacto, mitigação, responsável, score (prob × impacto)  │
│  Categorias: preco | fornecedor | juridico | tecnico | lgpd | impugnacao    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 8 — Redator ETP / TR                                                 │
│  Modelo:   Gemini 2.5 Pro                                                   │
│  Regra hard: escreve SOMENTE o que está no EvidenceBundle.                  │
│  Entrada:  EvidenceBundle completo                                           │
│  Saída:    DocumentoGerado (ETP em Markdown estruturado)                    │
│             DocumentoGerado (TR em Markdown estruturado)                    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTE 9 — Revisor / Auditor                                                │
│  Modelo:   Gemini 2.5 Pro                                                   │
│  Entrada:  DocumentoGerado + EvidenceBundle original                        │
│  Saída:    RelatorioRevisao                                                  │
│  → inconsistências encontradas, pendências, aprovação condicional           │
│  Verificações: coerência ETP↔TR, fontes de preço verificáveis, sem invenção│
└─────────────────────────────────────────────────────────────────────────────┘
```

### EvidenceBundle — coração do sistema

O `EvidenceBundle` é o objeto central que transita pelo pipeline. Ele acumula snapshots imutáveis de cada etapa:

```python
class EvidenceBundle(BaseModel):
    contratacao_id: UUID
    etapa: str
    demanda: DemandaEstruturada | None
    objeto: ObjetoDecomposto | None
    alternativas: MatrizAlternativas | None
    mapa_precos: MapaPrecos | None
    requisitos_tecnicos: RequisitosTecnicos | None
    validacao_juridica: ValidacaoJuridica | None
    matriz_riscos: MatrizRiscos | None
    # fontes normativas usadas no RAG
    fontes_normativas: list[FonteNormativa] = []
```

O redator **só pode usar** informações presentes no bundle. O revisor **cruza** o documento gerado com o bundle para detectar invenções.

---

## 7. Pipeline de Pesquisa de Preços

Esta é a etapa mais crítica operacionalmente do sistema, pois seus outputs têm validade jurídica e são auditáveis pelo TCU.

### Hierarquia de fontes

| Prioridade | Fonte | Tipo | Endpoint |
|---|---|---|---|
| 1 | PNCP | API oficial | `pncp.gov.br/api/pncp/v1/` |
| 2 | Compras.gov.br | API + CSV | `compras.dados.gov.br/v1` |
| 3 | Painel de Preços | API | `paineldeprecos.planejamento.gov.br/api/v1/` |
| 4 | Portais estaduais | Scraping/API | variável |
| 5 | Atas e contratos similares | PNCP filtrado | `filtro por objeto` |
| 6 | Propostas comerciais | Upload usuário | Document AI |
| 7 | Histórico interno | AlloyDB | tabela `itens_mercado` |
| 8 | Fabricantes/distribuidores | Upload manual | cotação formal |

### Fluxo do pipeline

```
Coleta (Cloud Tasks + rate limiting por IP)
  ↓
Extração (Document AI + Gemini Flash para parser estruturado)
  ↓
Normalização (unidade, vigência em meses, escala)
  ↓
Deduplicação (hash por órgão + objeto + data + valor)
  ↓
Comparabilidade (score multidimensional 0.0–1.0)
  ↓
Cálculo (média aritmética, mediana, menor preço aceitável)
  ↓
Evidência (pacote auditável com referências a todos os documentos fonte)
  ↓
Mapa de Preços (saída estruturada + exportação DOCX/XLSX)
```

### Regras de normalização

| Regra | Exemplo |
|---|---|
| Vigência diferente → normalizar por mês | R$ 5.000/usuário/36m ≠ R$ 5.000/usuário/12m |
| UST ≠ hora técnica ≠ ponto de função | não comparar sem conversão explícita registrada |
| Licença ≠ suporte ≠ implantação ≠ crédito | separar composição na coleta |
| Quantidade diferente → fator de escala | ±30% → alerta automático |
| Valor sem tributos explícitos → marcar como duvidoso | |
| Contrato > 24 meses desatualizado → rebaixar score −15 pts | |

---

## 8. Connectors para APIs Externas

### PNCP (`pncp_connector.py`)

```python
class PNCPClient:
    base_url = "https://pncp.gov.br/api/pncp"
    rate_limit = 60 req/min  # delay de 1.1s entre chamadas
    timeout = 30s
    max_retries = 3

# Endpoints consumidos:
GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens
GET /v1/atas          → atas de registro de preço
GET /v1/contratos     → contratos publicados
GET /v1/pca/itens     → itens do plano de contratação
```

- Chamadas enfileiradas via **Cloud Tasks** para respeitar rate limiting
- Resultados persistidos em AlloyDB (`fontes_mercado` + `itens_mercado`)
- `User-Agent` identificado: `xerticaproc/1.0 (contato@xertica.com)`

### Compras.gov (`compras_gov_connector.py`)

- Conecta em `compras.dados.gov.br/v1`
- Foco em itens homologados em catálogo (CATMAT/CATSER)
- Mesmo padrão de rate limiting via Cloud Tasks

### Atualização periódica

Um **Cloud Scheduler** aciona periodicamente a atualização do banco de preços histórico, garantindo que o pipeline de preços tenha dados recentes sem depender de busca ao vivo em todo request.

---

## 9. Modelo de Dados (AlloyDB)

**Cluster:** AlloyDB PostgreSQL em `operaciones-br / us-central1`  
**Schema:** `xerticaproc`  
**Extensões:** `pgvector`, `uuid-ossp`  
**Variável de conexão:** `ALLOYDB_URL` (asyncpg)

### Migrations

Gerenciadas pelo arquivo `infra/migrations/001_initial_schema.sql`, aplicado manualmente ou via script de bootstrap.

### Tabelas principais

```sql
-- Contratações em elaboração
contratacoes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orgao             TEXT NOT NULL,
  uasg              TEXT,
  unidade_demandante TEXT,
  objeto            TEXT NOT NULL,
  modalidade        TEXT,          -- pregao_eletronico | dispensa | inexigibilidade
  status            TEXT NOT NULL, -- rascunho|demanda|mercado|precos|etp|tr|revisao|aprovado
  responsavel       TEXT,
  data_criacao      TIMESTAMPTZ DEFAULT NOW(),
  versao_atual      INT DEFAULT 1,
  pca_id            TEXT,
  dados_entrada     JSONB,         -- DFD inicial, e-mails, atas uploadadas
  embedding         VECTOR(768)    -- similaridade semântica entre contratações
)

-- Documentos gerados (ETP, TR, Mapa de Preços, etc.)
documentos_gerados (
  id                UUID PRIMARY KEY,
  contratacao_id    UUID REFERENCES contratacoes(id),
  tipo              TEXT NOT NULL,  -- DFD|ETP|TR|mapa_precos|matriz_riscos|...
  versao            INT NOT NULL,
  conteudo          TEXT NOT NULL,  -- Markdown estruturado
  conteudo_html     TEXT,
  status_aprovacao  TEXT,           -- pendente|aprovado|rejeitado|revisao_solicitada
  criado_por        TEXT,
  criado_em         TIMESTAMPTZ DEFAULT NOW(),
  evidence_bundle_id UUID
)

-- Base normativa indexada com embeddings para RAG
fontes_normativas (
  id          UUID PRIMARY KEY,
  tipo        TEXT,               -- lei|IN|guia|modelo|jurisprudencia|sumula_tcu
  nome        TEXT NOT NULL,
  artigo      TEXT,
  trecho      TEXT,
  vigencia    DATE,
  url         TEXT,
  embedding   VECTOR(768)
)

-- Fontes de preço coletadas
fontes_mercado (
  id                 UUID PRIMARY KEY,
  tipo               TEXT NOT NULL,  -- pncp|compras_gov|arp|contrato|cotacao|...
  orgao              TEXT,
  uasg               TEXT,
  numero_documento   TEXT,
  url                TEXT,
  data_publicacao    DATE,
  data_coleta        TIMESTAMPTZ DEFAULT NOW(),
  confiabilidade     FLOAT DEFAULT 1.0,
  raw_json           JSONB
)

-- Itens de preço normalizados
itens_mercado (
  id                          UUID PRIMARY KEY,
  fonte_mercado_id            UUID REFERENCES fontes_mercado(id),
  contratacao_id              UUID REFERENCES contratacoes(id),
  descricao                   TEXT NOT NULL,
  descricao_normalizada       TEXT,
  catmat                      TEXT,
  catser                      TEXT,
  sku                         TEXT,
  fabricante                  TEXT,
  unidade                     TEXT NOT NULL,
  quantidade                  FLOAT,
  valor_unitario              FLOAT NOT NULL,
  valor_total                 FLOAT,
  vigencia_meses              INT,
  valor_mensal_por_unidade    FLOAT,   -- normalizado para comparação
  score_comparabilidade       FLOAT,
  score_detalhes              JSONB,
  embedding                   VECTOR(768)
)

-- Decisões técnicas rastreáveis
decisoes (
  id                UUID PRIMARY KEY,
  contratacao_id    UUID REFERENCES contratacoes(id),
  tipo              TEXT NOT NULL,   -- solucao_escolhida|preco_referencia|...
  justificativa     TEXT NOT NULL,
  evidencias        JSONB,           -- array de IDs de fontes usadas
  aprovado_por      TEXT,
  data              TIMESTAMPTZ DEFAULT NOW()
)

-- Matriz de riscos
riscos (
  id                UUID PRIMARY KEY,
  contratacao_id    UUID REFERENCES contratacoes(id),
  descricao         TEXT NOT NULL,
  categoria         TEXT,            -- preco|fornecedor|juridico|tecnico|lgpd|impugnacao
  probabilidade     TEXT,            -- alta|media|baixa
  impacto           TEXT,            -- alto|medio|baixo
  mitigacao         TEXT,
  responsavel       TEXT,
  score_risco       INT              -- calculado: probabilidade × impacto
)

-- Auditoria de execuções de agentes (rastreabilidade de IA)
prompt_execucoes (
  id               UUID PRIMARY KEY,
  contratacao_id   UUID,
  agente           TEXT NOT NULL,
  versao_prompt    TEXT NOT NULL,
  modelo           TEXT NOT NULL,
  entrada_hash     TEXT,     -- SHA-256 da entrada (sem PII)
  saida_hash       TEXT,
  fontes_usadas    JSONB,
  tokens_entrada   INT,
  tokens_saida     INT,
  latencia_ms      INT,
  data             TIMESTAMPTZ DEFAULT NOW()
)

-- Snapshots imutáveis de evidências por etapa
evidence_bundles (
  id               UUID PRIMARY KEY,
  contratacao_id   UUID REFERENCES contratacoes(id),
  etapa            TEXT NOT NULL,
  dados            JSONB NOT NULL,   -- snapshot completo de evidências naquele momento
  criado_em        TIMESTAMPTZ DEFAULT NOW()
)
```

### Índices recomendados

```sql
CREATE INDEX ON contratacoes (status);
CREATE INDEX ON contratacoes (orgao);
CREATE INDEX ON itens_mercado (contratacao_id);
CREATE INDEX ON itens_mercado (score_comparabilidade);
CREATE INDEX ON documentos_gerados (contratacao_id, tipo);
CREATE INDEX ON prompt_execucoes (agente, data);

-- pgvector para busca semântica
CREATE INDEX ON contratacoes USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON itens_mercado USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON fontes_normativas USING ivfflat (embedding vector_cosine_ops);
```

---

## 10. Schemas Pydantic (contrato de dados)

`backend/models/schemas.py` define todos os modelos de dados da plataforma.

### Enums de estado

| Enum | Valores |
|---|---|
| `StatusContratacao` | `rascunho` → `demanda` → `mercado` → `precos` → `etp` → `tr` → `revisao` → `aprovado` → `arquivado` |
| `TipoDocumento` | `DFD`, `ETP`, `TR`, `mapa_precos`, `matriz_riscos`, `matriz_alternativas`, `memoria_calculo`, `relatorio_evidencias`, `checklist_juridico` |
| `StatusAprovacao` | `pendente`, `aprovado`, `rejeitado`, `revisao_solicitada` |
| `TipoFonteMercado` | `pncp`, `compras_gov`, `painel_precos`, `arp`, `contrato`, `cotacao`, `fabricante`, `historico_interno`, `proposta_comercial` |
| `UnidadeMedida` | `usuario`, `licenca`, `hora`, `mensal`, `anual`, `unitario`, `ponto_funcao`, `ust` |

### Modelos principais

```
EntradaDemanda           → input inicial do formulário web
DemandaEstruturada       → output do Agente 1
ObjetoDecomposto         → output do Agente 2
MatrizAlternativas       → output do Agente 3
ItemPreco                → item normalizado com score
MapaPrecos               → output do Agente 4 (lista de ItemPreco + memória de cálculo)
RequisitosTecnicos       → output do Agente 5
ValidacaoJuridica        → output do Agente 6
MatrizRiscos             → output do Agente 7
DocumentoGerado          → output do Agente 8 (ETP ou TR em Markdown)
RelatorioRevisao         → output do Agente 9
EvidenceBundle           → acumulador de todos os outputs por contratação
ContratacaoCreated       → resposta da criação via REST
StatusEtapa              → resposta do polling de status
```

---

## 11. Score de Comparabilidade

Implementado em `backend/tools/comparabilidade.py`. É o mecanismo central de rastreabilidade dos preços coletados.

### Fórmula

```
Score = (
  + 20  se objeto similar (embedding cosine > threshold)
  + 20  se mesmo fabricante / SKU
  + 15  se mesma vigência normalizada (±10%)
  + 15  se mesma unidade de medida
  + 10  se mesma escala de quantidade (±30%)
  + 10  se mesma modalidade de contratação
  + 10  se mesma composição de suporte incluída
  + 10  se fonte oficial com URL verificável
  -  5  por divergência de escopo identificada
  - 10  por ausência de documento original
  - 15  por preço sem memória de cálculo
  - 20  se sem origem rastreável
) / 100       → resultado: float 0.0 – 1.0
```

### Classificação

| Score | Classificação | Uso no mapa de preços |
|---|---|---|
| ≥ 0.70 | Alta comparabilidade | Referência primária |
| ≥ 0.40 | Média comparabilidade | Referência secundária |
| ≥ 0.20 | Baixa comparabilidade | Apenas sensibilidade |
| < 0.20 | Descartado | Registrado com justificativa |

O score e seus detalhes (`score_detalhes JSONB`) são **sempre exibidos na interface** — guardrail G10 impede ocultação de baixa comparabilidade.

---

## 12. Guardrails — Regras Hard

Estas regras são **não negociáveis** e violações bloqueiam a pipeline ou geram alertas visíveis.

| # | Regra | Consequência |
|---|---|---|
| **G1** | Não gerar preço sem fonte verificável | Agente retorna `pendência`, bloqueia ETP |
| **G2** | Não citar marca sem justificativa técnica | Alerta automático no Revisor |
| **G3** | Não usar marketplace como fonte primária | Fonte bloqueada na coleta |
| **G4** | Não misturar licença com serviço técnico | Score de comparabilidade zerado |
| **G5** | Não comparar contratos de vigência diferente sem normalizar | Normalização obrigatória antes de inserir em `itens_mercado` |
| **G6** | Não usar documento sem data ou sem origem | Fonte descartada, justificativa registrada em `decisoes` |
| **G7** | Não concluir viabilidade sem matriz de alternativas | Agente 3 deve completar antes do Agente 8 executar |
| **G8** | TR incoerente com ETP → Revisor rejeita | Revisor retorna `rejeitado` com lista de divergências |
| **G9** | Não inventar item contratável | Output do Redator auditado contra EvidenceBundle pelo Revisor |
| **G10** | Não ocultar baixa comparabilidade | Score sempre exibido na interface, independente do valor |

---

## 13. Fluxo de Aprovação Humana

O sistema é **human-in-the-loop**: cada etapa pode ter um ponto de aprovação antes de avançar.

```
Demandante
  │ valida DFD e necessidade → aprova DemandaEstruturada
  ↓
TIC (equipe técnica)
  │ valida RequisitosTecnicos e ObjetoDecomposto → aprova ou solicita revisão
  ↓
Compras (setor de licitações)
  │ valida MapaPrecos → aprova preço de referência
  ↓
Jurídico
  │ valida ValidacaoJuridica e documentos → aprova conformidade normativa
  ↓
Autoridade Competente
  │ aprova encaminhamento para publicação
  ↓
Publicação no PNCP
```

Cada aprovação gera um registro na tabela `decisoes`:
```sql
INSERT INTO decisoes (contratacao_id, tipo, justificativa, evidencias, aprovado_por)
VALUES ($1, 'aprovacao_etapa', $2, $3, $4)
```

---

## 14. CI/CD com Cloud Build

`cloudbuild.yaml` na raiz de `xerticaproc/` define o pipeline completo.

### Pipeline de build

```
Step 1: build-backend
  docker build -f backend/Dockerfile -t $_REGISTRY/api:$COMMIT_SHA

Step 2: build-web           (paralelo com step 1 — waitFor: ["-"])
  docker build -f web/Dockerfile -t $_REGISTRY/web:$COMMIT_SHA

Step 3: push-backend        (após step 1)
  docker push --all-tags $_REGISTRY/api

Step 4: push-web            (após step 2)
  docker push --all-tags $_REGISTRY/web

Step 5: deploy-backend      (após step 3)
  gcloud run deploy xerticaproc-api

Step 6: deploy-web          (após step 4)
  gcloud run deploy xerticaproc-web
```

### Substituições (configuradas no trigger)

| Variável | Padrão | Descrição |
|---|---|---|
| `_PROJECT_ID` | `operaciones-br` | Projeto GCP |
| `_REGION` | `us-central1` | Região Cloud Run |
| `_BACKEND_SVC` | `xerticaproc-api` | Nome do serviço backend |
| `_WEB_SVC` | `xerticaproc-web` | Nome do serviço web |
| `_REGISTRY` | `us-central1-docker.pkg.dev/operaciones-br/xerticaproc` | Artifact Registry |
| `_ENV` | `prod` | Ambiente |

### Registry

Imagens publicadas em **Artifact Registry** (não GCR):
- `$_REGISTRY/api:$COMMIT_SHA` e `$_REGISTRY/api:latest`
- `$_REGISTRY/web:$COMMIT_SHA` e `$_REGISTRY/web:latest`

Máquina de build: `E2_HIGHCPU_8` para builds paralelos mais rápidos.

---

## 15. Infraestrutura como Código (Terraform)

**Localização:** `infra/terraform/`  
**Backend:** GCS bucket `xerticaproc-tf-state` (prefix `terraform/state`)  
**Versão:** Terraform ≥ 1.8, provider Google ~> 5.30

### Recursos provisionados

```
google_project_service          → APIs habilitadas (Cloud Run, AlloyDB, Vertex AI, etc.)
google_service_account          → SAs: xerticaproc-api, xerticaproc-web, xerticaproc-worker
google_alloydb_cluster          → cluster AlloyDB PostgreSQL
google_alloydb_instance         → instância primária + read replicas
google_cloud_run_v2_service     → xerticaproc-api + xerticaproc-web
google_bigquery_dataset         → dataset xerticaproc
google_storage_bucket           → documentos-brutos, documentos-gerados
google_secret_manager_secret    → NEXTAUTH_SECRET, GOOGLE_CLIENT_ID/SECRET, ALLOYDB_URL
google_pubsub_topic             → eventos de domínio
google_cloud_tasks_queue        → rate limiting de APIs externas
google_cloud_scheduler_job      → atualização periódica do banco de preços
google_artifact_registry_repository → xerticaproc (Docker)
google_cloudbuild_trigger       → CI/CD no push para main
```

### Outputs

`outputs.tf` expõe as URLs dos serviços Cloud Run para uso em scripts e documentação.

---

## 16. Stack GCP Completa

| Camada | Serviço GCP | Uso |
|---|---|---|
| **Frontend** | Cloud Run | Next.js 15 — wizard ETP/TR, painel de preços |
| **Backend API** | Cloud Run | FastAPI — pipeline ADK, endpoints REST |
| **Orquestração** | GCP Workflows | Fluxos longos: coleta preços, geração completa ETP/TR |
| **Mensageria** | Pub/Sub | Eventos: novo documento, preço coletado, análise concluída |
| **Filas** | Cloud Tasks | Rate limiting para PNCP e Compras.gov (60 req/min) |
| **Scheduler** | Cloud Scheduler | Atualização periódica do banco de preços histórico |
| **IA — Agentes** | Vertex AI Gemini 2.5 Pro | Análise profunda, redação, revisão |
| **IA — Extração** | Vertex AI Gemini 2.5 Flash | Normalização, extração, decomposição |
| **Agentes ADK** | Google ADK | SequentialAgent + LlmAgent por etapa |
| **OCR/Parse** | Document AI | Extração de atas, contratos, propostas comerciais em PDF |
| **Busca semântica** | pgvector (AlloyDB) | Contratações similares, itens similares, base normativa |
| **Busca semântica (escala)** | Vertex AI Vector Search | Alternativa gerenciada para grandes volumes |
| **Banco principal** | AlloyDB PostgreSQL | Dados operacionais + pgvector + alta disponibilidade |
| **Analytics** | BigQuery | Histórico de preços, auditoria, BI, Looker Studio |
| **Documentos** | Cloud Storage | PDFs brutos e gerados (DOCX/PDF/XLSX) |
| **Exportação** | Cloud Run Job | Geração DOCX/PDF/XLSX via python-docx + reportlab |
| **Imagens** | Artifact Registry | Repositório Docker (xerticaproc/api, xerticaproc/web) |
| **CI/CD** | Cloud Build | Build paralelo + push + deploy automático |
| **IaC** | Terraform | Toda infraestrutura gerenciada como código |
| **Segredos** | Secret Manager | Credenciais OAuth, ALLOYDB_URL, chaves de API |
| **Criptografia** | Cloud KMS | Chaves de criptografia gerenciadas |
| **Autenticação** | IAM + IAP | Service accounts, Identity-Aware Proxy |
| **Auditoria IA** | Cloud Audit Logs | Chamadas Vertex AI, acessos a dados sensíveis |
| **DLP** | Cloud DLP | Detecção de PII em documentos e logs |
| **Observabilidade** | Cloud Logging + Monitoring | Métricas, alertas, rastreabilidade por contratacao_id |
| **Erros** | Error Reporting | Exceções em produção com contexto da contratação |

---

## 17. Segurança e Conformidade

### Autenticação e autorização

- **Usuários:** Google OAuth via NextAuth, restrito a `@xertica.com`
- **Serviços:** Google ID-token injetado pelo proxy frontend → verificado pelo backend
- **Service Accounts:** mínimo privilégio (SA separado para API, web e worker)
- **IAP:** Cloud Run não é diretamente acessível; todo acesso externo passa pelo web

### Dados sensíveis

- Credenciais exclusivamente em **Secret Manager** (nunca em env var hardcoded ou código)
- `prompt_execucoes` registra hash SHA-256 da entrada, **nunca o conteúdo com PII**
- Cloud DLP monitora documentos e logs para detectar dados pessoais inadvertidos

### Conformidade LGPD

- Dados de identificação de servidores públicos tratados conforme base legal: execução de contrato de trabalho / interesse público
- Documentos brutos (propostas comerciais com CNPJ/CPF de representantes) devem ser mascarados após extração
- Agente Jurídico inclui checklist LGPD na `ValidacaoJuridica`

### Rastreabilidade de IA (auditoria TCU)

Cada execução de agente registra em `prompt_execucoes`:
- `versao_prompt`: hash do prompt de sistema usado
- `modelo`: versão exata do modelo (`gemini-2.5-pro-preview-xxx`)
- `fontes_usadas`: array de IDs de fontes consultadas
- `entrada_hash` e `saida_hash`: reprodutibilidade sem expor conteúdo
- `latencia_ms`, `tokens_entrada`, `tokens_saida`: custo e performance

---

## 18. Observabilidade

### Logging estruturado (JSON)

`logging_config.py` configura o logger em formato JSON com campos padrão do Cloud Logging:
- `severity` mapeado para níveis Python
- `contratacao_id` injetado em todo log relacionado a uma contratação
- `agente` identifica o contexto de execução

### Métricas de negócio no BigQuery

| Tabela BQ | Métricas extraíveis |
|---|---|
| `mapa_precos_historico` | Evolução de preços por objeto, por órgão, por período |
| `fontes_mercado` | Volume de fontes coletadas, distribuição por tipo |
| `itens_mercado` | Distribuição de scores de comparabilidade |
| `prompt_execucoes` | Latência por agente, custo de tokens, taxa de erro |

### Alertas Cloud Monitoring

- Taxa de erro da API > 1% → alerta P1
- Latência p99 > 30s → alerta P2 (agentes com timeout)
- Falha no conector PNCP por > 5 min → alerta P2
- Contratações presas em status por > 1h → alerta P3

---

## 19. Roadmap de Sprints

### Sprint 1 — Base (semanas 1–4)
- [ ] Infraestrutura Terraform (AlloyDB, Cloud Run, BQ, Storage)
- [ ] Schema AlloyDB + migração 001
- [ ] FastAPI base + health + auth (ID-token)
- [ ] Upload de documentos + Document AI
- [ ] Agente Demanda + Agente Técnico (MVP)
- [ ] Geração ETP/TR a partir de template (sem pesquisa de preços)
- [ ] Base normativa Lei 14.133 + IN 94 indexada com embeddings

### Sprint 2 — Pesquisa de Preços (semanas 5–8)
- [ ] Conector PNCP (atas, contratos, editais)
- [ ] Conector Compras.gov (itens homologados)
- [ ] Conector Painel de Preços
- [ ] Pipeline de normalização de unidades e vigências
- [ ] Score de comparabilidade (comparabilidade.py)
- [ ] Mapa de Preços (AlloyDB + BQ)
- [ ] Cloud Tasks para rate limiting de APIs externas
- [ ] Cloud Scheduler para atualização periódica

### Sprint 3 — Agentes Especializados (semanas 9–12)
- [ ] Agente Decomposição do Objeto
- [ ] Agente Pesquisa de Mercado (matriz de alternativas)
- [ ] Agente Preços (completo com PNCP + Compras.gov)
- [ ] Agente Jurídico (RAG sobre base normativa com pgvector)
- [ ] Agente Riscos
- [ ] Agente Redator (ETP + TR com evidence bundle)
- [ ] Agente Revisor/Auditor
- [ ] GCP Workflows para orquestração de fluxos longos

### Sprint 4 — Governança e Produção (semanas 13–16)
- [ ] Controle de versões de documentos (tabela `documentos_gerados`)
- [ ] Workflow de aprovação por papéis (`decisoes`)
- [ ] Exportação DOCX/PDF/XLSX (Cloud Run Job)
- [ ] Vertex AI Vector Search para contratações similares em escala
- [ ] Dashboards BigQuery + Looker Studio
- [ ] Cloud DLP para detecção de PII
- [ ] Integração com SEI (opcional, via API REST do SEI)
- [ ] Testes de carga e otimização de latência dos agentes

---

## Apêndice A — Variáveis de Ambiente backend

| Variável | Padrão | Descrição |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | `operaciones-br` | Projeto GCP |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | Região Vertex AI |
| `ALLOYDB_URL` | — (Secret Manager) | Connection string asyncpg |
| `LOG_LEVEL` | `INFO` | Nível de log |
| `ENV` | `prod` | Ambiente |

## Apêndice B — Fluxo de desenvolvimento local

```bash
# Backend
cd xerticaproc
pip install -e ".[dev]"
uvicorn xerticaproc.backend.main:app --reload --port 8080

# Web
cd xerticaproc/web
npm install
npm run dev          # http://localhost:3000

# Build e push manual (substituto para Cloud Build em debug)
SHA=$(git rev-parse --short HEAD)
gcloud builds submit . \
  --project=operaciones-br \
  --config=cloudbuild.yaml \
  --substitutions=COMMIT_SHA=$SHA,_ENV=staging
```

## Apêndice C — Nomes de serviços Cloud Run em produção

| Serviço | URL | SA |
|---|---|---|
| `xerticaproc-api` | `https://xerticaproc-api-<hash>-uc.a.run.app` | `xerticaproc-api@operaciones-br.iam` |
| `xerticaproc-web` | `https://xerticaproc-web-<hash>-uc.a.run.app` | `xerticaproc-web@operaciones-br.iam` |
