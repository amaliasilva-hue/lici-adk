# Document Model Compiler — Plano de Arquitetura
## Módulo de Aprendizagem por Modelos Documentais para xerticaproc

> **Status:** Planejamento — v0.1 — 06/05/2026  
> **Contexto:** Extensão do xerticaproc para absorver modelos grandes de ETP/TR/edital
> e transformá-los em ativos reutilizáveis, sem fine-tuning prematuro.

---

## 1. Problema que este módulo resolve

A plataforma atual (xerticaproc) gera ETP e TR **do zero** usando os agentes e
pesquisa de preços. O problema: ela ignora o conhecimento institucional acumulado em
modelos existentes — documentos de 50–200 páginas que já passaram por aprovação
jurídica, técnica e normativa.

Este módulo não treina o modelo. Ele **compila** esses documentos em uma biblioteca
operacional estruturada que os agentes consultam durante a geração.

**Analogia:** a diferença entre um engenheiro que digitou 10.000 linhas de código
e um que tem uma biblioteca com 500 funções testadas. O segundo não começa do zero.

---

## 2. Posição na arquitetura geral

```
                        ┌──────────────────────────────────────────────┐
                        │            xerticaproc (existente)           │
                        │                                              │
  Upload demanda        │  Agentes: demanda → precos → redator → TR   │
  ──────────────────→   │                     ↑                        │
                        │               consulta                       │
                        │             biblioteca                       │
                        │                  ↑                           │
                        └──────────────────┼───────────────────────────┘
                                           │
                        ┌──────────────────┼───────────────────────────┐
                        │      Document Model Compiler (NOVO)          │
                        │                                              │
  Modelos grandes       │  Upload → Parse → Compilar → Curar →        │
  ──────────────────→   │  Publicar → Biblioteca de ativos            │
                        │                                              │
                        └──────────────────────────────────────────────┘
```

O fluxo de geração existente **não muda**. O que muda é que os agentes passam a ter
uma biblioteca de cláusulas, blocos e exemplos para consultar antes de redigir.

---

## 3. O que é um "modelo" para este sistema

Um modelo é qualquer documento grande já produzido que serve de referência:

| Tipo | Exemplos | Tamanho típico |
|---|---|---|
| ETP aprovado | ETP DESO v2, ETP Gemini Enterprise | 30–80 páginas |
| TR aprovado | TR IA Corporativa GCP, TR UST Especializada | 50–120 páginas |
| Edital completo | Edital Pregão IA, Edital Software | 100–200 páginas |
| Mapa de preços | Mapa Gemini Enterprise, Mapa UST | 10–30 páginas |
| Matriz de riscos | Matriz IA Generativa, Matriz Cloud | 5–20 páginas |

Cada um será compilado em camadas reutilizáveis, **não** jogado bruto no RAG.

---

## 4. Cinco formas de "ensinar" (em ordem de custo/benefício)

| # | Forma | Quando usar | Custo |
|---|---|---|---|
| 1 | **Templates estruturados** | Sempre — estrutura do documento | Baixo |
| 2 | **Biblioteca de cláusulas** | Blocos de texto reutilizável | Baixo |
| 3 | **RAG de exemplos** | Recuperação semântica de trechos | Médio |
| 4 | **Context cache** | Modelos grandes usados com frequência | Médio |
| 5 | **Fine-tuning supervisionado** | Só com dataset maduro e rotulado | Alto |

**Este módulo implementa 1, 2, 3 e 4. Fine-tuning fica para fase futura.**

---

## 5. Arquitetura detalhada do módulo

### 5.1 Fluxo de ingestão

```
Usuário faz upload do modelo grande
           ↓
   Cloud Storage (bucket: xerticaproc-modelos)
           ↓
   Document AI — Layout Parser
   (extrai: texto, tabelas, listas, numeração, hierarquia)
           ↓
   document_parser_agent.py
   (Gemini Pro — identifica seções, variáveis, cláusulas)
           ↓
   Document Model Compiler
   (normaliza, classifica, gera embeddings)
           ↓
   Curadoria humana (UI de aprovação)
           ↓
   Base de modelos documentais (AlloyDB)
   + Vertex AI RAG Engine (vetores)
```

### 5.2 Componentes novos a criar

#### Backend
```
backend/
  agents/
    document_parser_agent.py     ← novo: extrai estrutura do documento
    document_compiler_agent.py   ← novo: gera template canônico
    clause_extractor_agent.py    ← novo: isola e classifica cláusulas
  connectors/
    document_ai_connector.py     ← novo: client do Document AI
  tools/
    rag_tools.py                 ← novo: interface Vertex AI RAG Engine
    context_cache_tools.py       ← novo: gerencia context cache do Gemini
  models/
    document_model_schemas.py    ← novo: modelos Pydantic para os ativos
  routers/
    modelos_router.py            ← novo: endpoints REST para gestão dos modelos
```

#### Infra
```
infra/
  terraform/
    document_ai.tf               ← novo: Document AI processor
    rag_engine.tf                ← novo: Vertex AI RAG Engine corpus
  migrations/
    002_document_models.sql      ← novo: tabelas do módulo
  workflows/
    ingestao_modelo.yaml         ← novo: workflow de ingestão assíncrona
```

#### Web
```
web/src/app/
  modelos/
    page.tsx                     ← listagem e upload de modelos
    [id]/
      page.tsx                   ← detalhe: seções, cláusulas, variáveis
      curadoria/
        page.tsx                 ← aprovação humana por bloco
  biblioteca/
    page.tsx                     ← busca na biblioteca de cláusulas
```

---

## 6. Camadas de extração por documento

Para cada modelo ingerido, o compilador extrai **seis camadas**:

### Camada 1 — Estrutura
```json
{
  "tipo_documento": "TR",
  "familia": "IA corporativa em GCP",
  "secoes": [
    { "ordem": 1, "nome": "Identificação", "obrigatoria": true, "condicional": false },
    { "ordem": 2, "nome": "Justificativa", "obrigatoria": true, "condicional": false },
    { "ordem": 3, "nome": "Composição do objeto", "obrigatoria": true },
    { "ordem": 4, "nome": "Requisitos técnicos", "obrigatoria": true },
    { "ordem": 5, "nome": "Proteção de dados (LGPD)", "obrigatoria": false,
      "condicional": "quando houver dados pessoais" },
    { "ordem": 6, "nome": "Governança de IA", "obrigatoria": false,
      "condicional": "quando objeto incluir IA generativa" }
  ]
}
```

### Camada 2 — Variáveis identificadas
```json
{
  "variaveis": [
    { "nome": "orgao", "tipo": "string", "obrigatoria": true },
    { "nome": "quantidade_licencas", "tipo": "integer", "origem": "demanda" },
    { "nome": "valor_creditos_gcp", "tipo": "decimal", "origem": "mapa_precos" },
    { "nome": "quantidade_ust", "tipo": "integer", "origem": "decomposicao" },
    { "nome": "vigencia_meses", "tipo": "integer", "origem": "demanda" }
  ]
}
```

### Camada 3 — Blocos reutilizáveis (cláusulas)
```json
{
  "clausulas": [
    {
      "id": "clause_lgpd_ia_001",
      "titulo": "Proteção de dados em soluções de IA",
      "texto_normalizado": "...",
      "quando_usar": ["objeto contém IA generativa", "há processamento de dados pessoais"],
      "quando_nao_usar": ["contratação de hardware sem software"],
      "base_normativa": ["Lei 13.709/2018 art. 46", "IN SGD/ME 94/2022 §3"],
      "qualidade": 0.92,
      "aprovado": true
    }
  ]
}
```

### Camada 4 — Regras de uso
```json
{
  "regras": [
    {
      "id": "rule_ia_001",
      "regra": "Resultados de IA generativa devem ter revisão humana obrigatória",
      "severidade": "bloqueante",
      "quando_aplicar": "objeto contém IA generativa",
      "base_normativa": "IN SGD/ME 94/2022"
    },
    {
      "id": "rule_credito_001",
      "regra": "Créditos de nuvem não consumidos não devem ser pagos",
      "severidade": "bloqueante",
      "quando_aplicar": "objeto contém créditos GCP/Azure/AWS"
    }
  ]
}
```

### Camada 5 — Padrões de estilo
```json
{
  "estilo": {
    "tom": "técnico-institucional",
    "nivel_detalhe": "alto",
    "forma": "justificativa argumentativa",
    "riscos": ["linguagem comercial", "termos subjetivos sem critério"],
    "preferencia": "redação defensável para instrução processual",
    "exemplos_positivos": ["...trecho de boa redação..."],
    "exemplos_negativos": ["...trecho a evitar..."]
  }
}
```

### Camada 6 — Padrões de decisão
```json
{
  "padroes_decisao": [
    {
      "condicao": "objeto inclui IA generativa",
      "implicacoes": [
        "exigir governança de IA",
        "exigir revisão humana dos resultados",
        "incluir cláusula LGPD reforçada",
        "tratar dados sensíveis na matriz de riscos",
        "prever controle de consumo de tokens",
        "prever capacitação da equipe gestora"
      ]
    }
  ]
}
```

---

## 7. Schema de banco de dados (migration 002)

```sql
-- Modelos documentais
CREATE TABLE document_models (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome            TEXT NOT NULL,
  tipo_documento  tipo_documento NOT NULL,           -- ETP, TR, DFD, PCA
  familia         TEXT,                              -- 'IA corporativa GCP', etc.
  area            TEXT,                              -- TIC, IA, cloud, software
  orgao_origem    TEXT,
  versao          TEXT NOT NULL DEFAULT '1.0',
  status          TEXT NOT NULL DEFAULT 'pendente'   -- pendente, curadoria, validado, obsoleto
                  CHECK (status IN ('pendente','curadoria','validado','obsoleto')),
  nivel_qualidade NUMERIC(3,2),                      -- 0.0–1.0
  aprovado_por    TEXT,
  validade_dias   INT DEFAULT 180,
  storage_uri     TEXT NOT NULL,                     -- gs://... arquivo original
  estrutura_json  JSONB,                             -- camada 1
  variaveis_json  JSONB,                             -- camada 2
  estilo_json     JSONB,                             -- camada 5
  decisoes_json   JSONB,                             -- camada 6
  rag_corpus_id   TEXT,                              -- ID no Vertex AI RAG Engine
  context_cache_name TEXT,                           -- nome do context cache
  tokens_originais INT,
  importado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validado_em     TIMESTAMPTZ,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seções extraídas
CREATE TABLE document_sections (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id        UUID NOT NULL REFERENCES document_models(id) ON DELETE CASCADE,
  nome_secao      TEXT NOT NULL,
  ordem           INT NOT NULL,
  obrigatoria     BOOLEAN NOT NULL DEFAULT TRUE,
  condicional     TEXT,                              -- condição de uso (texto livre)
  finalidade      TEXT,
  texto_original  TEXT,
  texto_normalizado TEXT,
  embedding       vector(768),
  aprovada        BOOLEAN,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cláusulas e blocos reutilizáveis
CREATE TABLE document_clauses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id        UUID NOT NULL REFERENCES document_models(id) ON DELETE CASCADE,
  section_id      UUID REFERENCES document_sections(id) ON DELETE SET NULL,
  titulo          TEXT NOT NULL,
  tipo            TEXT,                              -- clausula, bloco, paragrafo, nota
  texto_original  TEXT NOT NULL,
  texto_normalizado TEXT,
  quando_usar     TEXT[] NOT NULL DEFAULT '{}',
  quando_nao_usar TEXT[] NOT NULL DEFAULT '{}',
  base_normativa  TEXT[] NOT NULL DEFAULT '{}',
  riscos          TEXT[] NOT NULL DEFAULT '{}',
  score_qualidade NUMERIC(3,2),
  aprovada        BOOLEAN DEFAULT FALSE,
  curador         TEXT,
  embedding       vector(768),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Variáveis identificadas
CREATE TABLE document_variables (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id        UUID NOT NULL REFERENCES document_models(id) ON DELETE CASCADE,
  nome_variavel   TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'string',    -- string, integer, decimal, date, boolean
  obrigatoria     BOOLEAN NOT NULL DEFAULT TRUE,
  origem_dado     TEXT,                              -- demanda, mapa_precos, decomposicao, manual
  descricao       TEXT,
  exemplo         TEXT
);

-- Regras extraídas
CREATE TABLE document_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id        UUID NOT NULL REFERENCES document_models(id) ON DELETE CASCADE,
  regra           TEXT NOT NULL,
  severidade      TEXT NOT NULL DEFAULT 'aviso'
                  CHECK (severidade IN ('bloqueante','aviso','sugestao')),
  quando_aplicar  TEXT,
  base_normativa  TEXT,
  validacao_expr  TEXT,                              -- expressão para validação automática
  mensagem_erro   TEXT,
  ativa           BOOLEAN NOT NULL DEFAULT TRUE
);

-- Exemplos de boa redação
CREATE TABLE document_examples (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_id        UUID NOT NULL REFERENCES document_models(id) ON DELETE CASCADE,
  tipo_tarefa     TEXT NOT NULL,                     -- necessidade, requisito, risco, etc.
  entrada         TEXT,                              -- contexto que levou ao trecho
  saida_esperada  TEXT NOT NULL,                     -- o trecho de qualidade
  qualidade       NUMERIC(3,2),
  aprovado        BOOLEAN DEFAULT FALSE,
  embedding       vector(768)
);

-- Rastreabilidade: qual modelo foi usado em cada geração
CREATE TABLE geracao_modelo_uso (
  id              BIGSERIAL PRIMARY KEY,
  contratacao_id  UUID NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  model_id        UUID NOT NULL REFERENCES document_models(id),
  clause_ids      UUID[],                            -- cláusulas aproveitadas
  exemplo_ids     UUID[],                            -- exemplos utilizados
  tipo_documento  tipo_documento NOT NULL,
  score_aderencia NUMERIC(3,2),                      -- % do documento derivado de modelos
  registrado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Índices essenciais:**
```sql
CREATE INDEX idx_clauses_model     ON document_clauses (model_id, aprovada);
CREATE INDEX idx_clauses_embedding ON document_clauses USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_sections_embed    ON document_sections USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_examples_embed    ON document_examples USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_models_status     ON document_models (status, tipo_documento);
```

---

## 8. Agentes novos

### 8.1 `document_parser_agent.py`
**Responsabilidade:** Receber o resultado do Document AI Layout Parser e identificar
a estrutura hierárquica do documento.

**Entrada:** texto + layout JSON do Document AI  
**Saída:** `DocumentoAnalisado` (seções, hierarquia, tipo, família)  
**Modelo:** Gemini 2.5 Pro (contexto longo para documentos grandes)  
**Técnica:** context cache para o documento original

### 8.2 `document_compiler_agent.py`
**Responsabilidade:** A partir das seções identificadas, gerar o template canônico
— estrutura, variáveis, condições de uso, padrões de estilo.

**Entrada:** `DocumentoAnalisado`  
**Saída:** `TemplateCanônico` (camadas 1–6)  
**Modelo:** Gemini 2.5 Pro

### 8.3 `clause_extractor_agent.py`
**Responsabilidade:** Isolar cláusulas e blocos reutilizáveis, classificar tipo,
identificar base normativa, marcar quando usar / quando não usar.

**Entrada:** seções do documento  
**Saída:** lista de `ClausulaNormalizada`  
**Modelo:** Gemini 2.5 Flash (operação em volume)

### 8.4 Atualização dos agentes existentes

`redator_agent.py` e `revisor_agent.py` recebem dois novos inputs:

```python
# adicionado ao bundle
clausulas_sugeridas: list[ClausulaNormalizada]   # recuperadas por RAG
exemplos_estilo: list[DocumentoExemplo]          # exemplos aprovados
regras_ativas: list[RegraDocumental]             # validações obrigatórias
```

---

## 9. Serviços GCP adicionais

| Serviço | Uso neste módulo | Já existe? |
|---|---|---|
| Document AI Layout Parser | Extração estrutural de PDFs/DOCX | Não — novo |
| Vertex AI RAG Engine | Corpus de cláusulas e exemplos com busca semântica | Não — novo |
| Gemini context cache | Armazenar documento grande para múltiplas chamadas | Não — novo |
| Cloud Storage (novo bucket) | `xerticaproc-modelos` — originais + processados | Novo bucket |
| AlloyDB (tabelas novas) | Metadados dos modelos e cláusulas | Migração 002 |
| Cloud Tasks | Ingestão assíncrona de documentos grandes | Já existe |
| Cloud Build | CI/CD já existente cobre os novos componentes | Já existe |

### 9.1 Document AI Layout Parser

```python
# document_ai_connector.py (novo)
from google.cloud import documentai_v1 as documentai

# processa PDF/DOCX e retorna elementos estruturados:
# - paragraphs, headings, tables, lists com layout e hierarquia
# - chunks conscientes de contexto (não quebra por token cego)
```

**Custo estimado:** ~$10/1.000 páginas (Layout Parser).

### 9.2 Vertex AI RAG Engine

```python
# rag_tools.py (novo)
# Corpus criado por familia de modelo:
#   - corpus "TR IA Corporativa" 
#   - corpus "ETP Serviços TIC"
#   - corpus "Cláusulas LGPD"
# Recupera chunks por similaridade semântica + filtro por metadados
```

### 9.3 Gemini Context Cache

```python
# context_cache_tools.py (novo)
# Para documentos de referência com > 32k tokens usados repetidamente:
# - cria cache do documento compilado
# - economiza custo de input tokens nas gerações subsequentes
# - TTL configurável (24h padrão para modelos validados)
```

---

## 10. Como a geração muda (fluxo enriquecido)

**Antes (atual):**
```
demanda → decomposicao → mercado → precos → tecnico → juridico →
riscos → redator (do zero) → revisor
```

**Depois (com Document Model Compiler):**
```
demanda → decomposicao → mercado → precos → tecnico → juridico →
riscos
  ↓
template_selector (escolhe familia de modelo)
  ↓
clause_retriever (busca cláusulas por RAG)
  ↓
example_retriever (busca exemplos por RAG)
  ↓
rule_loader (carrega regras ativas)
  ↓
redator (com esqueleto + cláusulas + exemplos)
  ↓
revisor (valida contra regras + template)
```

A saída do `redator_agent` passará a registrar:
- qual template foi usado
- quais cláusulas foram aproveitadas (com ID e versão)
- qual % do documento veio de modelos validados (score de aderência)

---

## 11. Curadoria humana — fluxo obrigatório

Nenhum bloco é usado em geração sem aprovação humana. O fluxo:

```
Modelo importado
    ↓
IA extrai + classifica automaticamente
    ↓
UI de curadoria (novo: /modelos/[id]/curadoria)
    ↓
Curador marca cada bloco:
  ✅  pode reutilizar (sem restrição)
  ⚠️  usar com cuidado (adiciona nota ao agente)
  🔒  depende do tipo de contratação (condicional)
  ❌  proibido reutilizar (ex: cláusula restritiva, referência normativa vencida)
    ↓
Revisão jurídica para cláusulas-chave
    ↓
Publicação com versão e validade
```

**Motivos para rejeitar uma cláusula:**
- Referência normativa revogada ou desatualizada
- Exigência restritiva que pode configurar direcionamento
- Preço ou quantitativo específico vencido
- Linguagem comercial (`"solução líder de mercado"`)
- Objeto mal delimitado
- Modalidade incompatível com o objeto

---

## 12. Versionamento e rastreabilidade

Cada modelo publicado recebe:

```
Modelo: TR IA Corporativa GCP
Versão: 1.0
Origem: DESO / xerticaproc interno
Status: validado
Validade: 180 dias (vence 01/11/2026)
Revisão normativa: aprovada (jurídico, 05/05/2026)
```

Cada documento gerado registra:

```json
{
  "rastreabilidade": {
    "template_usado": "TR IA Corporativa GCP v1.0",
    "clausulas_aproveitadas": ["clause_lgpd_ia_001 v1.0", "clause_govai_002 v1.0"],
    "exemplos_usados": ["example_necessidade_ia_003"],
    "regras_validadas": 12,
    "regras_violadas": 0,
    "score_aderencia_template": 0.84,
    "gemini_model": "gemini-2.5-pro-preview-05-06",
    "context_cache_name": "cachedContents/tr-ia-corp-v1"
  }
}
```

---

## 13. Endpoints REST novos

```
# Gestão de modelos
POST   /proc/modelos                          ← upload + inicia ingestão
GET    /proc/modelos                          ← lista com filtros
GET    /proc/modelos/{id}                     ← detalhe + estrutura extraída
PATCH  /proc/modelos/{id}/status              ← aprovar / publicar / deprecar

# Curadoria
GET    /proc/modelos/{id}/clausulas           ← lista cláusulas para curadoria
PATCH  /proc/modelos/{id}/clausulas/{cid}     ← aprovar/rejeitar/condicionar

# Biblioteca
GET    /proc/biblioteca/clausulas             ← busca semântica por cláusulas aprovadas
GET    /proc/biblioteca/exemplos              ← busca semântica por exemplos
GET    /proc/biblioteca/templates             ← templates canônicos por tipo/família

# Rastreabilidade
GET    /proc/contratacoes/{id}/rastreabilidade ← quais modelos foram usados
```

---

## 14. Plano de implementação (4 sprints)

### Sprint A — Ingestão e parsing (2 semanas)
- [ ] `document_ai_connector.py` — integração Layout Parser
- [ ] `document_parser_agent.py` — extração de estrutura
- [ ] Migration 002 — tabelas do módulo
- [ ] `POST /proc/modelos` + Cloud Tasks para ingestão assíncrona
- [ ] Workflow `ingestao_modelo.yaml`
- [ ] Bucket `xerticaproc-modelos` no Terraform

### Sprint B — Compilação e extração (2 semanas)
- [ ] `document_compiler_agent.py` — template canônico (camadas 1–6)
- [ ] `clause_extractor_agent.py` — biblioteca de cláusulas + embeddings
- [ ] `document_model_schemas.py` — Pydantic para os novos modelos
- [ ] `GET /proc/modelos/{id}` com estrutura completa
- [ ] Vertex AI RAG Engine corpus (Terraform: `rag_engine.tf`)

### Sprint C — Curadoria e biblioteca (1 semana)
- [ ] UI curadoria: `/modelos/[id]/curadoria/page.tsx`
- [ ] `PATCH clausulas/{cid}` — aprovação humana
- [ ] `GET /proc/biblioteca/clausulas` — busca semântica
- [ ] `GET /proc/biblioteca/templates`

### Sprint D — Integração com geração (1 semana)
- [ ] `rag_tools.py` + `context_cache_tools.py`
- [ ] Atualizar `redator_agent.py` para consumir biblioteca
- [ ] Atualizar `revisor_agent.py` para validar contra regras
- [ ] `geracao_modelo_uso` — rastreabilidade por documento gerado
- [ ] `GET /proc/contratacoes/{id}/rastreabilidade`

---

## 15. O que NÃO fazer (anti-padrões)

| Anti-padrão | Problema | Alternativa |
|---|---|---|
| Jogar 200 páginas no RAG sem estrutura | Recuperação imprecisa, contexto perdido | Compilar em camadas estruturadas |
| Fine-tuning imediato sem dataset maduro | Custo alto, resultado pior que prompting | RAG + templates primeiro |
| Chunking por token fixo (1.000 tok) | Quebra cláusulas no meio | Layout Parser com chunking semântico |
| Aprender automaticamente sem curadoria | Propaga erros, cláusulas restritivas | Fluxo de aprovação humana obrigatório |
| Um único corpus para todos os tipos | Precisão de busca baixa | Corpus por família de documento |
| Reutilizar cláusulas com data vencida | Vício no documento | Controle de validade + alerta de expiração |

---

## 16. Dependências dos modelos que você já tem

Com base nos modelos existentes (DESO/Gemini Enterprise, TR UST, TR IA Corporativa),
as famílias iniciais a compilar são:

| Família | Documentos de origem | Cláusulas esperadas |
|---|---|---|
| IA corporativa em GCP | TR DESO Gemini Enterprise, ETP Gemini | ~40 cláusulas |
| Serviços especializados UST | TR UST, modelos de medição | ~25 cláusulas |
| Software como serviço (SaaS) | TRs de licenciamento | ~20 cláusulas |
| Infraestrutura cloud | TRs de crédito GCP/Azure | ~15 cláusulas |
| Bases transversais | LGPD, sustentabilidade, acessibilidade | ~30 cláusulas |

**Início recomendado:** família "IA corporativa em GCP" — é a mais madura,
mais verificada juridicamente e mais demandada.

---

## 17. Próximos passos imediatos

1. **Você faz:** Listar os modelos grandes que quer ensinar (nome, tipo, origem, status normativo)
2. **Plataforma faz:** Criar bucket `xerticaproc-modelos` + UI de upload
3. **Você faz:** Upload do primeiro modelo (sugestão: TR IA Corporativa GCP)
4. **Plataforma faz:** Parsing automático + extração de estrutura
5. **Você faz:** Curadoria — aprovar/rejeitar cada bloco extraído
6. **Plataforma faz:** Publicar o primeiro template canônico
7. **Validar:** Gerar um TR novo usando o template e comparar com o original

---

*Documento vivo — atualizar a cada sprint.*
