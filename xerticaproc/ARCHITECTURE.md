# xerticaproc — Plataforma de Inteligência para ETP/TR
**Versão:** 1.0 | **Data:** 2026-05-06 | **Projeto GCP:** operaciones-br

---

## 1. Visão Geral

`xerticaproc` é a plataforma de geração de ETP (Estudo Técnico Preliminar) e TR (Termo de Referência) para contratações públicas de TIC, conforme Lei nº 14.133/2021 e IN SGD/ME nº 94/2022.

Diferencial: **não gera texto bonito — gera processo defensável com evidências rastreáveis**.

Responde a qualquer tempo:
- Por que essa solução?
- Por que esse preço?
- Quais fontes foram usadas/descartadas?
- Quem aprovou? Qual versão do prompt/modelo gerou isso?

---

## 2. Separação de Responsabilidades (xerticaproc vs lici-adk)

| Sistema | Pergunta | Usuário |
|---|---|---|
| **lici-adk** | "A Xertica deve participar neste edital?" | Vendedor / CE |
| **xerticaproc** | "Como montar o ETP/TR desta contratação?" | Servidor público / equipe de compras |

Os dois sistemas **coexistem** no mesmo projeto GCP (`operaciones-br`), compartilhando:
- Vertex AI / Gemini
- AlloyDB PostgreSQL (schemas separados)
- BigQuery (datasets separados)
- Cloud Storage (buckets separados)

---

## 3. Arquitetura GCP

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Browser (servidor público / equipe TIC)                                      │
│  ── Google OAuth (NextAuth) → Google ID token                                 │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ HTTPS
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  xerticaproc-web  (Next.js 15 · Cloud Run · operaciones-br/us-central1)       │
│  ── Wizard por etapa: DFD → Mercado → Preços → ETP → TR → Revisão → Export   │
│  ── SSR + API Routes (proxy autenticado para backend)                         │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ HTTPS autenticado (ID token)
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  xerticaproc-api  (FastAPI · Cloud Run · operaciones-br/us-central1)          │
│                                                                                │
│  POST /proc/contratacoes              → cria contratação                       │
│  POST /proc/contratacoes/{id}/demanda → aciona agente demanda                 │
│  POST /proc/contratacoes/{id}/mercado → aciona pesquisa de mercado            │
│  POST /proc/contratacoes/{id}/precos  → aciona pipeline de preços             │
│  POST /proc/contratacoes/{id}/etp     → gera ETP                              │
│  POST /proc/contratacoes/{id}/tr      → gera TR                               │
│  POST /proc/contratacoes/{id}/revisao → agente revisor/auditor                │
│  GET  /proc/contratacoes/{id}/status  → polling de status                     │
│  GET  /proc/contratacoes/{id}/mapa-precos → retorna mapa de preços            │
│  GET  /proc/contratacoes/{id}/evidencias  → pacote de evidências              │
│  GET  /proc/healthz                                                            │
│                                                                                │
│  Pipeline ADK (SequentialAgent) por etapa:                                    │
│  ┌──────────┐ ┌───────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐  │
│  │ Demanda  │→│Decomposic.│→│Mercado │→│Preços  │→│Técnico │→│ Jurídico │  │
│  └──────────┘ └───────────┘ └────────┘ └────────┘ └────────┘ └──────────┘  │
│                                                 ↓                             │
│                              ┌────────┐ ┌──────────┐ ┌──────────┐           │
│                              │Riscos  │→│  Redator │→│ Revisor  │           │
│                              └────────┘ └──────────┘ └──────────┘           │
└──┬─────────────────────────────┬──────────────────────┬─────────────────────┘
   │ Vertex AI Gemini            │ AlloyDB + pgvector   │ BQ Analytics
   ▼                             ▼                      ▼
┌──────────────┐  ┌─────────────────────────────┐  ┌──────────────────────┐
│ Gemini 2.5   │  │ operaciones-br              │  │ operaciones-br       │
│ Flash / Pro  │  │  alloydb/xerticaproc        │  │  .xerticaproc        │
│              │  │   ├─ contratacoes           │  │   ├─ mapa_precos_hist│
│              │  │   ├─ documentos_gerados    │  │   ├─ fontes_mercado  │
│              │  │   ├─ fontes_normativas      │  │   ├─ itens_mercado   │
│              │  │   ├─ fontes_mercado         │  │   ├─ evidencias      │
│              │  │   ├─ itens_mercado          │  │   └─ prompt_exec     │
│              │  │   ├─ decisoes               │  └──────────────────────┘
│              │  │   ├─ riscos                 │
│              │  │   ├─ prompt_execucoes       │
│              │  │   └─ embeddings (pgvector)  │
│              │  └─────────────────────────────┘
└──────────────┘
```

---

## 4. Fontes de Preços (Pipeline Dedicado)

### 4.1 Hierarquia de Fontes

| Prioridade | Fonte | Tipo | Endpoint/Método |
|---|---|---|---|
| 1 | PNCP | API oficial | `pncp.gov.br/api/pncp/v1/` |
| 2 | Compras.gov.br | API + CSV | `compras.gov.br/api_compras/v1/` |
| 3 | Painel de Preços | API | `paineldeprecos.planejamento.gov.br/api/v1/` |
| 4 | Portais estaduais | Scraping/API | variável |
| 5 | Atas e contratos de órgãos similares | PNCP | filtro por objeto |
| 6 | Propostas comerciais | Upload usuário | Document AI |
| 7 | Histórico interno | AlloyDB | tabela `itens_mercado` |
| 8 | Fabricantes/distribuidores | Cotação formal | upload manual |

### 4.2 Pipeline de Preços

```
Coleta (Cloud Tasks + rate limiting)
  ↓
Extração (Document AI + Gemini Flash)
  ↓
Normalização (unidade, vigência, escala)
  ↓
Deduplicação (hash por órgão+objeto+data+valor)
  ↓
Comparabilidade (score multidimensional)
  ↓
Cálculo (média, mediana, menor preço)
  ↓
Evidência (pacote auditável)
  ↓
Mapa de Preços (saída estruturada + DOCX/XLSX)
```

### 4.3 Score de Comparabilidade

```
Score = (
  + 20 se objeto similar
  + 20 se mesmo fabricante/SKU
  + 15 se mesma vigência (normalizada)
  + 15 se mesma unidade de medida
  + 10 se mesma escala de quantidade (± 30%)
  + 10 se mesma modalidade
  + 10 se mesma composição de suporte incluída
  + 10 se fonte oficial com URL verificável
  -  5 por divergência de escopo identificada
  - 10 por ausência de documento original
  - 15 por preço sem memória de cálculo
  - 20 se sem origem rastreável
) / 100

Classificação:
  >= 0.70 → alta comparabilidade → referência primária
  >= 0.40 → média comparabilidade → referência secundária
  >= 0.20 → baixa comparabilidade → usado apenas como sensibilidade
  <  0.20 → descartado (com justificativa registrada)
```

### 4.4 Regras de Normalização

| Regra | Exemplo |
|---|---|
| Vigência diferente → normalizar por mês | R$ 5.000/usuário/36m ≠ R$ 5.000/usuário/12m |
| UST ≠ hora técnica ≠ ponto de função | não comparar sem conversão explícita |
| Licença ≠ suporte ≠ implantação ≠ crédito | separar composição |
| Quantidade diferente → aplicar fator de escala | acima/abaixo de 30% → alerta |
| Valor sem IVA explícito → marcar como duvidoso | |
| Contrato desatualizado > 24 meses → rebaixar score 15pts | |

---

## 5. Agentes do Sistema

### Agente 1 — Demanda / DFD
- **Entrada:** conversa guiada + upload de DFD/e-mails/atas
- **Modelo:** Gemini 2.5 Pro
- **Saída:** `DemandaEstruturada` (problema, objetivo, unidade, prazo, restrições, PCA)

### Agente 2 — Decomposição do Objeto
- **Entrada:** `DemandaEstruturada`
- **Modelo:** Gemini 2.5 Flash
- **Saída:** `ObjetoDecomposto` (itens contratáveis, alertas de direcionamento)

### Agente 3 — Pesquisa de Mercado
- **Entrada:** `ObjetoDecomposto`
- **Modelo:** Gemini 2.5 Pro + Agent Search
- **Saída:** `MatrizAlternativas` (solução A/B/C/D, vantagens, desvantagens, custo estimado)

### Agente 4 — Preços (crítico operacional)
- **Entrada:** `ObjetoDecomposto` + filtros
- **Modelo:** Gemini 2.5 Flash + FunctionTools (PNCP, Compras.gov, AlloyDB)
- **Saída:** `MapaPrecos` (fontes aceitas/descartadas, score, memória de cálculo)

### Agente 5 — Técnico
- **Entrada:** `DemandaEstruturada` + `ObjetoDecomposto`
- **Modelo:** Gemini 2.5 Flash
- **Saída:** `RequisitosTecnicos` (funcionais, não-funcionais, segurança, SLA)

### Agente 6 — Jurídico/Normativo
- **Entrada:** documentos parciais + `RequisitosTecnicos`
- **Modelo:** Gemini 2.5 Pro + RAG sobre base normativa
- **Saída:** `ValidacaoJuridica` (aderência Lei 14.133, IN94, LGPD, checklist)

### Agente 7 — Riscos
- **Entrada:** todo estado da contratação
- **Modelo:** Gemini 2.5 Flash
- **Saída:** `MatrizRiscos` (probabilidade, impacto, mitigação, responsável)

### Agente 8 — Redator ETP/TR
- **Entrada:** `EvidenceBundle` completo (todos os outputs anteriores)
- **Modelo:** Gemini 2.5 Pro
- **Regra hard:** só escreve o que está no `EvidenceBundle`. Sem invenção de fonte/preço/requisito.
- **Saída:** `DocumentoGerado` (ETP ou TR em Markdown estruturado)

### Agente 9 — Revisor/Auditor
- **Entrada:** `DocumentoGerado` + `EvidenceBundle`
- **Modelo:** Gemini 2.5 Pro
- **Saída:** `RelatorioRevisao` (inconsistências, pendências, aprovação condicional)

---

## 6. Modelo de Dados (AlloyDB PostgreSQL)

```sql
-- Schema: xerticaproc

contratacoes (
  id UUID PK,
  orgao TEXT NOT NULL,
  uasg TEXT,
  unidade_demandante TEXT,
  objeto TEXT NOT NULL,
  modalidade TEXT,          -- pregao_eletronico, dispensa, inexigibilidade
  status TEXT NOT NULL,     -- rascunho|demanda|mercado|precos|etp|tr|revisao|aprovado
  responsavel TEXT,
  data_criacao TIMESTAMPTZ DEFAULT NOW(),
  versao_atual INT DEFAULT 1,
  pca_id TEXT,              -- referência ao PCA/PDTIC
  dados_entrada JSONB,      -- DFD inicial, e-mails, atas uploadadas
  embedding VECTOR(768)     -- para busca semântica de contratações similares
)

documentos_gerados (
  id UUID PK,
  contratacao_id UUID REFERENCES contratacoes(id),
  tipo TEXT NOT NULL,       -- DFD|ETP|TR|mapa_precos|matriz_riscos|matriz_alternativas
  versao INT NOT NULL,
  conteudo TEXT NOT NULL,   -- Markdown estruturado
  conteudo_html TEXT,
  status_aprovacao TEXT,    -- pendente|aprovado|rejeitado
  criado_por TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  evidence_bundle_id UUID
)

fontes_normativas (
  id UUID PK,
  tipo TEXT,                -- lei|IN|guia|modelo|jurisprudencia|sumula_tcu
  nome TEXT NOT NULL,
  artigo TEXT,
  trecho TEXT,
  vigencia DATE,
  url TEXT,
  embedding VECTOR(768)
)

fontes_mercado (
  id UUID PK,
  tipo TEXT NOT NULL,       -- pncp|compras_gov|arp|contrato|cotacao|fabricante|historico
  orgao TEXT,
  uasg TEXT,
  numero_documento TEXT,
  url TEXT,
  data_publicacao DATE,
  data_coleta TIMESTAMPTZ DEFAULT NOW(),
  confiabilidade FLOAT DEFAULT 1.0,
  raw_json JSONB
)

itens_mercado (
  id UUID PK,
  fonte_mercado_id UUID REFERENCES fontes_mercado(id),
  contratacao_id UUID REFERENCES contratacoes(id),
  descricao TEXT NOT NULL,
  descricao_normalizada TEXT,
  catmat TEXT,
  catser TEXT,
  sku TEXT,
  fabricante TEXT,
  unidade TEXT NOT NULL,
  quantidade FLOAT,
  valor_unitario FLOAT NOT NULL,
  valor_total FLOAT,
  vigencia_meses INT,
  valor_mensal_por_unidade FLOAT,   -- normalizado
  score_comparabilidade FLOAT,
  score_detalhes JSONB,
  embedding VECTOR(768)
)

decisoes (
  id UUID PK,
  contratacao_id UUID REFERENCES contratacoes(id),
  tipo TEXT NOT NULL,       -- solucao_escolhida|preço_referencia|requisito_incluido
  justificativa TEXT NOT NULL,
  evidencias JSONB,         -- array de IDs de fontes usadas
  aprovado_por TEXT,
  data TIMESTAMPTZ DEFAULT NOW()
)

riscos (
  id UUID PK,
  contratacao_id UUID REFERENCES contratacoes(id),
  descricao TEXT NOT NULL,
  categoria TEXT,           -- preco|fornecedor|juridico|tecnico|lgpd|impugnacao
  probabilidade TEXT,       -- alta|media|baixa
  impacto TEXT,             -- alto|medio|baixo
  mitigacao TEXT,
  responsavel TEXT,
  score_risco INT           -- calculado: probabilidade × impacto
)

prompt_execucoes (
  id UUID PK,
  contratacao_id UUID,
  agente TEXT NOT NULL,
  versao_prompt TEXT NOT NULL,
  modelo TEXT NOT NULL,
  entrada_hash TEXT,         -- SHA-256 da entrada (sem PII)
  saida_hash TEXT,
  fontes_usadas JSONB,
  tokens_entrada INT,
  tokens_saida INT,
  latencia_ms INT,
  data TIMESTAMPTZ DEFAULT NOW()
)

evidence_bundles (
  id UUID PK,
  contratacao_id UUID REFERENCES contratacoes(id),
  etapa TEXT NOT NULL,
  dados JSONB NOT NULL,      -- snapshot completo de evidências no momento
  criado_em TIMESTAMPTZ DEFAULT NOW()
)
```

---

## 7. Guardrails (Regras Hard — não negociáveis)

| # | Regra | Consequência se violada |
|---|---|---|
| G1 | Não gerar preço sem fonte verificável | Agente retorna `pendência` |
| G2 | Não citar marca sem justificativa técnica | Alerta automático no revisor |
| G3 | Não usar marketplace como fonte primária | Source bloqueada no pipeline |
| G4 | Não misturar licença com serviço técnico | Score de comparabilidade zerado |
| G5 | Não comparar contratos de vigência diferente sem normalizar | Normalização obrigatória antes de inserir |
| G6 | Não usar documento sem data ou sem origem | Fonte descartada com justificativa |
| G7 | Não concluir viabilidade sem matriz de alternativas | Bloqueia geração do ETP |
| G8 | TR incoerente com ETP → revisor rejeita | Revisão retorna `rejeitado` |
| G9 | Não inventar item contratável | Output do redator auditável contra bundle |
| G10 | Não ocultar baixa comparabilidade | Score sempre exibido na interface |

---

## 8. Stack GCP Completa

| Camada | Serviço | Uso |
|---|---|---|
| **Frontend** | Cloud Run | Next.js 15 — wizard ETP/TR, painel de preços |
| **Backend API** | Cloud Run | FastAPI — pipeline ADK, endpoints REST |
| **Orquestração** | GCP Workflows | Fluxos longos: coleta preços, geração ETP/TR |
| **Mensageria** | Pub/Sub | Eventos: novo documento, preço coletado, análise concluída |
| **Filas** | Cloud Tasks | Rate limiting para APIs externas (PNCP, Compras.gov) |
| **Scheduler** | Cloud Scheduler | Atualização periódica do banco de preços |
| **IA** | Vertex AI / Gemini 2.5 | Flash (extração/normalização) + Pro (redação/revisão) |
| **Agentes** | Google ADK | SequentialAgent + LlmAgent por etapa |
| **Busca semântica** | Vertex AI Vector Search | Contratações similares, itens similares |
| **Banco principal** | AlloyDB PostgreSQL | Dados operacionais + pgvector |
| **Analytics** | BigQuery | Histórico de preços, auditoria, BI |
| **Documentos** | Cloud Storage | PDFs brutos, DOCX/PDF gerados |
| **OCR/Parse** | Document AI | Extração de atas, contratos, propostas |
| **Segurança** | IAM + IAP + KMS + Secret Manager | Autenticação, criptografia, segredos |
| **Auditoria** | Cloud Audit Logs + DLP | Trilha completa, detecção de PII |
| **Observabilidade** | Cloud Logging + Monitoring + Error Reporting | Métricas, alertas, rastreabilidade |
| **CI/CD** | Cloud Build + Artifact Registry | Build, push, deploy automático |
| **Exportação** | Cloud Run Job | Geração DOCX/PDF/XLSX via python-docx + reportlab |

---

## 9. Papéis e Aprovação (Fluxo Humano)

```
Demandante → valida DFD e necessidade
    ↓
TIC → valida requisitos técnicos
    ↓
Compras → valida pesquisa de preços e mapa
    ↓
Jurídico → valida conformidade normativa
    ↓
Autoridade competente → aprova encaminhamento
```

Cada etapa gera um registro em `decisoes` com `aprovado_por`, `justificativa` e `evidencias`.

---

## 10. Sprints de Implantação

### Sprint 1 — Base (semanas 1–4)
- [ ] Infraestrutura Terraform (AlloyDB, Cloud Run, BQ dataset, Storage)
- [ ] Schema AlloyDB + migrações
- [ ] FastAPI base + health + auth
- [ ] Upload de documentos + Document AI
- [ ] Agente Demanda + Agente Técnico
- [ ] Geração ETP/TR a partir de template (sem pesquisa de preços)
- [ ] Base normativa Lei 14.133 + IN 94 indexada com embeddings

### Sprint 2 — Pesquisa de Preços (semanas 5–8)
- [ ] Conector PNCP (atas, contratos, editais)
- [ ] Conector Compras.gov (itens homologados)
- [ ] Conector Painel de Preços
- [ ] Pipeline de normalização
- [ ] Score de comparabilidade
- [ ] Mapa de preços (AlloyDB + BQ)
- [ ] Cloud Tasks para rate limiting
- [ ] Cloud Scheduler para atualização periódica

### Sprint 3 — Agentes Especializados (semanas 9–12)
- [ ] Agente Decomposição
- [ ] Agente Mercado (matriz de alternativas)
- [ ] Agente Preços (completo com PNCP + Compras.gov)
- [ ] Agente Jurídico (RAG sobre base normativa)
- [ ] Agente Riscos
- [ ] Agente Redator (ETP + TR com evidence bundle)
- [ ] Agente Revisor/Auditor
- [ ] GCP Workflows para orquestração completa

### Sprint 4 — Governança e Produção (semanas 13–16)
- [ ] Controle de versões de documentos
- [ ] Aprovação por papéis (workflow de aprovação)
- [ ] Exportação DOCX/PDF/XLSX
- [ ] Vertex AI Vector Search (similaridade semântica)
- [ ] Dashboards BigQuery + Looker Studio
- [ ] DLP para detecção de dados pessoais
- [ ] Integração com SEI (opcional, API REST)
- [ ] Testes de carga e otimização
