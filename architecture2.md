# x-lici — Arquitetura do Sistema de Inteligência Licitatória (v2)

> **Status:** complementa e substitui x-biding v0.1. Documento canônico a partir daqui.
> Estende a arquitetura do lici-adk (v1, validada com PRODESP) sem quebrar o que já funciona.
> **Data:** 2026-04-18

---

## 1. O que é x-lici

x-lici é o sistema único de inteligência licitatória da Xertica.
Não é "lici-adk + x-biding". É um produto só, com três camadas que operam em cima do mesmo edital:

| Camada | Pergunta que responde | Automação atual |
|---|---|---|
| Comercial | "A Xertica deve participar? Onde estão os gaps?" | lici-adk v1 — já funciona (validado PRODESP) |
| Jurídica | "O edital está legal? Há cláusulas impugnáveis? Quais minutas?" | A construir — herda Extrator, adiciona Analista Licitatório |
| Operacional | "Em que fase está? Quem é responsável? O que falta?" | A construir — controle de editais (8 stages + gates), comentários, anexos, integração Drive |

- **Usuário primário:** jurídico terceirizado (o operador que avança stages do edital)
- **Usuário secundário:** vendedor / Customer Engineer (vinculado ao edital, comenta, aprova)
- **Usuário terciário:** diretoria (vê pipeline agregado)
- **Substitui:** o Trello atual. Sem coexistência.
- **Fronteira do produto:** x-lici termina em `homologado`. O pós-homologação (empenho, entrega, contrato) é responsabilidade do SaaS de contratos (integração futura — Fase 10).

---

## 2. Princípios arquiteturais (trava contra escopo mutante)

1. **Drive é fonte de verdade da operação jurídica.** O app lê do Drive via Drive API. Nunca sobrescreve. Jurídico continua operando como hoje.
2. **BigQuery é fonte de verdade analítica.** Toda análise persiste em `operaciones-br.lici_adk.*`. BQ é warehouse de leitura — não armazena estado operacional mutável.
3. **Cloud SQL Postgres é fonte de verdade operacional.** Editais, stages, comentários, movimentações, gates e súmulas TCU vivem no Postgres. Writes frequentes, transações ACID, queries de latência baixa.
4. **Datastream sincroniza Cloud SQL → BQ.** Estado operacional replica automaticamente para o warehouse. Sem ETL manual.
5. **Um backend só.** FastAPI único em Cloud Run, projeto `operaciones-br`. Endpoints novos se somam aos existentes.
6. **Um frontend só.** Next.js em Cloud Run, servindo controle de editais, análise, histórico, config. Identidade visual Xertica (brand kit oficial).
7. **Extrator é compartilhado.** O lici-adk já extrai o edital estruturado. O Analista Comercial e o Analista Licitatório consomem o mesmo output.
8. **Auth Google OAuth @xertica.com.** Jurídico terceirizado recebe conta `@xertica.com` pelo Workspace ou acesso controlado por email whitelist.
9. **Sem `--allow-unauthenticated`.** Cloud Run autenticado. Frontend SSR injeta token service-to-service. Zero exposição pública.

---

## 3. Identidade visual (Brand Kit oficial v.2)

> Isso não é decoração — é parte da especificação.

### Paletas

| Uso | Hex | Quando usar |
|---|---|---|
| Primary Brand 100 | `#047EA9` | Headers, CTA primário |
| Primary 50 (Legacy) | `#00BEFF` | Acentos, links, badges neutros |
| Green Brand 50 | `#C0FF7D` | Status positivo (APTO, Ganho, Conforme) |
| Pink Brand 50 | `#FF89FF` | Destaque jurídico, novidade, "novo comentário" |
| Red Brand 50 | `#E14849` | Alertas críticos (NO-GO, glosa alta, bloqueador legal) |
| Background UI | `#14263D` | Fundo principal escuro (navy) |

### Tipografia

- Títulos: **Poppins Bold**
- Corpo: **Roboto**
- Monoespaçada (ids, logs): **Roboto Mono**

### Iconografia

- Primária: MUI Icons (`@mui/icons-material`)
- Complementar: Pictogrammers / Material Design Icons

### Gradientes

3 lineares (azul primário, verde lime, pink magenta) + 1 rounded para fundos de cards destacados.
Uso: card do edital em destaque, header de análise, badges de status premium.

### Estilo geral

Dark mode como default, glassmorphism sutil em cards, glow de cor nos elementos-chave (azul para ações, verde para sucesso, pink para novidade), transições suaves.

**Implementação:** Tailwind CSS com theme customizado + shadcn/ui + MUI Icons.

---

## 4. Diagrama de arquitetura

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser — @xertica.com (jurídico terceirizado + vendedor + diretor)  │
│    · NextAuth Google Provider (hd=xertica.com)                        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  HTTPS
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  x-lici-web (Next.js 14 · Cloud Run · operaciones-br/us-central1)    │
│                                                                        │
│  Páginas:                                                              │
│    /             Pipeline de editais (stages, lista por stage)        │
│    /edital/[id]  Edital: análise comercial + jurídica + comentários + │
│                  anexos (espelhados do Drive) + movimentação          │
│    /upload       Upload do edital → cria registro → roda pipeline     │
│    /historico  Busca/filtro (órgão, UF, status, vendedor, data)       │
│    /config     Prompt customizável por usuário                        │
│    /admin      Monitoramento + editor de súmulas (/admin/sumulas)     │
│                                                                        │
│  SSR chama backend com Service Account ID token (service-to-service)  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  HTTPS + SA ID token
                               │  (user email em header X-User-Email)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  x-lici-backend (FastAPI · Cloud Run · operaciones-br/us-central1)   │
│  --no-allow-unauthenticated                                           │
│                                                                        │
│  ENDPOINTS — EDITAIS                                                   │
│    POST /editais                       cria edital (dispara pipeline) │
│    GET  /editais · GET /editais/{id}   lê estado do edital            │
│    PATCH /editais/{id}                 atualiza fase/vendedor/campos  │
│    POST /editais/{id}/comentarios      adiciona comentário            │
│    POST /editais/{id}/analise_juridica dispara Analista Licitatório   │
│                                                                        │
│  ENDPOINTS — DRIVE                                                     │
│    GET  /editais/{id}/drive/arvore         lista pastas/arquivos      │
│    POST /editais/{id}/drive/upload         upload → subpasta certa    │
│    POST /editais/{id}/drive/sincronizar    força re-scan              │
│    GET  /editais/{id}/drive/atestados_somados  somatório              │
│                                                                        │
│  PIPELINE (um edital, dois analistas em paralelo):                    │
│                                                                        │
│    ┌──────────┐                                                        │
│    │ Extrator │── shared ──┬──▶ ┌─────────────────────┐              │
│    │ (Flash)  │            │    │ Analista Comercial  │──▶ Parecer   │
│    └──────────┘            │    │ (Pro + YAML +       │    comercial │
│                            │    │  BQ + somatório)    │              │
│    ┌──────────────────┐    │    └─────────────────────┘              │
│    │ Qualificador     │────┤                                          │
│    │ (BQ + somatório) │    └──▶ ┌─────────────────────┐              │
│    └──────────────────┘         │ Analista Licitatório│──▶ Relatório │
│            │                    │ (Pro + Lei 14.133 + │    jurídico  │
│            └─ atestados ──────▶ │  TCU súmulas +      │    6 blocos  │
│               somados           │  custom_prompt)     │              │
│                                 └─────────────────────┘              │
│                                           │                           │
│                                           ▼                           │
│                           ┌─────────────────────────┐                │
│                           │ Persistor               │                │
│                           │ (edital + 2 análises)   │                │
│                           └─────────────────────────┘                │
└───┬────────────────────┬──────────────────┬──────────┬────────────┘
    │ Vertex AI          │ Cloud SQL        │ Drive API│
    ▼                    ▼                  │          │
┌──────────────┐  ┌────────────────────┐   │          │
│ Gemini 2.5   │  │ Cloud SQL Postgres  │   │          │
│ Flash / Pro  │  │ operaciones-br      │   │          │
└──────────────┘  │ (db-g1-small)       │   │          │
                  │                     │   │          │
                  │ editais             │   │          │
                  │ edital_movimentacoes│   │          │
                  │ edital_comentarios  │   │          │
                  │ edital_gates        │   ▼          │
                  │ tcu_sumulas         │  ┌──────────────────────┐
                  │ tcu_sumulas_hist.   │  │ Google Drive         │
                  │ atestados_cache     │  │ Xertica Licitações/  │
                  │ usuarios            │  │  [UF]/[Processo]/    │
                  └────────┬───────────┘  │   ├─ Edital/         │
                           │ Datastream   │   ├─ Atestados/      │
                           │ CDC → BQ     │   ├─ Habilitação/    │
                           ▼              │   ├─ Proposta/       │
                  ┌────────────────────┐  │   └─ Contrato/       │
                  │ BigQuery           │  │                      │
                  │ operaciones-br     │  │ read-only no MVP     │
                  │ .lici_adk:         │  └──────────────────────┘
                  │  .analises_editais │
                  │  .analises_jur.    │
                  │  .docs_protocolo   │
                  │  .eventos_pipeline │
                  └────────────────────┘
```

---

## 5. O que reaproveita do lici-adk v1 (validado)

### Intocado (sem refactor)

- `backend/agents/extrator.py` — Gemini 2.5 Flash, PDF multimodal
- `backend/agents/qualificador.py` — queries BigQuery + 5 modos avançados
- `backend/agents/analista.py` — Gemini 2.5 Pro + YAML + Chain-of-Thought + Camada 1/2
- `backend/models/schemas.py` — `EditalEstruturado`, `QualificadorResult`, `ParecerFinal`, `Evidencia`
- `backend/xertica_profile.yaml` — realidade contratual vs narrativa GTM
- `backend/tools/bigquery_tools.py` — 6 query tools

### Renomeado sem mudança interna

- `analista.py` → `analista_comercial.py`
- `ParecerFinal` → `ParecerComercial` (em `schemas.py`)

### Endpoint legado

`POST /analyze` vira alias de `POST /editais` — cria edital automaticamente, devolve `analysis_id=edital_id`.
O campo `analysis_id` no response **mantém o mesmo nome** (string UUID) para não quebrar scripts existentes.

---

## 6. O que é novo

### 6.1 Analista Licitatório

`backend/agents/analista_licitatorio.py` — não toca `analista.py`.

| Aspecto | Valor |
|---|---|
| Modelo | `gemini-2.5-pro` |
| Input | `EditalEstruturado` + `BidConfig` (custom prompt opcional) + knowledge inline |
| Knowledge | Lei 14.133/2021 (in-context) + `tcu_sumulas.yaml` curadas |
| Output | `RelatorioLicitatorio` — 6 blocos |
| BQ | Não consulta — análise jurídica é sobre edital + lei, não histórico Xertica |

**Output — 6 blocos** (schema Pydantic em `schemas.py`):

1. **`FichaProcesso`** — órgão, UF, objeto, modalidade, valor, prazo, resumo executivo; inclui **`prazos_calculados`**: `data_limite_esclarecimento` (−5 dias úteis da sessão, art. 164 §1º) e `data_limite_impugnacao` (−3 dias úteis, art. 164 *caput*) calculadas automaticamente a partir de `data_encerramento`
2. **`AtestadoAnalise`** — `permite_somatorio?` · `exige_parcela_maior_relevancia?` · `percentual_minimo` (≤50% legal, art. 67 §2º) · `restricao_temporal` (vedada art. 67 §2º) · `restricao_local` (vedada) · `conformidade` (CONFORME / IRREGULAR / RESTRITIVO / INCONCLUSIVO) · `fundamentacao` · `alertas`
3. **`RiscoJuridico`** — `indicadores_economicos` (PL ≤10%) · `clausulas_restritivas` · `riscos` · `nivel_risco` (BAIXO / MEDIO / ALTO / CRITICO)
4. **`DocumentosProtocolo`** (lista) — cada documento tem: `tipo` (**ESCLARECIMENTO** | **IMPUGNACAO**), `topico`, `numero_clausula`, `clausula_questionada`, `prazo_limite` (calculado a partir do Bloco 1 — esclarecimento: art. 164 §1º, −5 dias úteis; impugnação: art. 164 *caput*, −3 dias úteis), `destinatario` (pregoeiro / autoridade competente), `texto_formal` (pronto para protocolar), `base_legal` (artigos exatos + súmulas TCU aplicáveis)
5. **`CardExecutivo`** — `conformidade_geral` · `score_conformidade` (0–100) · `pontos_criticos` · `recomendacao` ("participar" / "impugnar antes" / "aguardar retificação") · `proximos_passos`
6. **`KitHabilitacao`** — `atestados_recomendados` (lista de arquivos Drive com `drive_file_id`, `drive_file_name`, volume contribuído e flag `satisfaz_parcela_maior_relevancia`) · `declaracoes_necessarias` (lista das declarações exigidas/padrão — ver §6.7) · `certidoes_checklist` (CND Federal, CND FGTS, CND Estadual, CNDT, certidão de débitos trabalhistas — cada uma com `obrigatorio` e `validade_dias`) · `gap_habilitacao` (texto livre: o que falta e precisa ser providenciado antes da sessão)

---

### 6.2 Somador de Atestados (feature crítica)

**Problema:** o lici-adk qualifica com base no BigQuery. Na montagem da proposta, o time precisa somar atestados para cobrir escala (ex: edital pede 540k licenças GWS — 1 atestado sozinho não cobre, 4 somados cobrem).

**Solução:** tool `somar_atestados_do_drive(edital_id)`:

1. Lê a subpasta `Atestados/` do edital no Drive via Drive API
2. Para cada PDF, chama Gemini Flash multimodal → extrai `{drive_file_id, drive_file_name, contratante, objeto, periodo, volume, categoria, pagina_referencia}`
3. Agrupa por categoria (`GWS`, `GCP`, `GMP`, `UST`, `bolsa_horas`, `interacoes_chatbot`)
4. Soma os volumes; marca individualmente quais atestados sozinhos atendem `parcela_maior_relevancia` do edital (≥ 4% do valor estimado, art. 67 §1º)
5. Retorna:
   - `{categoria: total_somado, atestados_contribuintes: [{drive_file_id, drive_file_name, contratante, volume_contribuido, satisfaz_parcela_maior_relevancia: bool}]}`
   - `kit_minimo_recomendado`: subconjunto mínimo de atestados que cobre o requisito do edital (priorizando os de maior volume para minimizar a quantidade de docs; garante pelo menos 1 com `satisfaz_parcela_maior_relevancia = true` se o edital o exigir)

**Impacto nos dois analistas:**

- **Analista Comercial:** antes de dizer "gap de 500k licenças", verifica o somatório → "somatório: 480k; gap real: 60k"
- **Analista Licitatório:** verifica se edital permite somatório (art. 67 + TCU) → se não permite, gera minuta de impugnação no Bloco 4

---

### 6.3 Integração com Google Drive

**Princípio: zero fricção com o jurídico. Eles continuam no Drive.**

**Estrutura esperada:**

```
📁 Xertica Licitações/
  └── 📁 [UF]/
      └── 📁 [Número do Processo] - [Órgão]/
          ├── 📁 Edital/          ← PDF principal
          ├── 📁 Atestados/       ← somador lê daqui (crítico)
          ├── 📁 Habilitação/     ← certidões, balanço
          ├── 📁 Proposta/        ← em construção pelo vendedor
          └── 📁 Contrato/        ← pós-ganho
```

| Fase | Upload onde? | Quem faz |
|---|---|---|
| MVP (Fases 1–6) | No Drive direto (como hoje) | Jurídico |
| V1 (Fase 8+) | No app → app sobe no Drive via API | Jurídico ou vendedor |

Sincronização no MVP: background job a cada 15 min verificando timestamp; arquivo novo → re-processa somatório + notifica edital.

**Autenticação Drive:**
- SA do backend com Domain-Wide Delegation — impersona o email do usuário do request
- Fallback: SA com acesso direto às pastas compartilhadas (se DWD não for aprovado)

---

### 6.4 Sistema de Controle de Editais (substitui Trello)

**Não é kanban genérico.** É um pipeline de licitación com stages tipados, gates por checklist e estados terminais. x-lici termina em `homologado` — o que vem depois (empenho, entrega, contrato) vai para o SaaS de contratos (Fase 10).

**Stages (8):**

| # | Stage | Quem opera |
|---|---|---|
| 1 | `identificacao` | Vendedor |
| 2 | `analise` | Vendedor + Jurídico |
| 3 | `pre_disputa` | Jurídico (esclarecimentos, impugnações) |
| 4 | `proposta` | Vendedor + CE |
| 5 | `disputa` | Vendedor |
| 6 | `habilitacao` | Jurídico |
| 7 | `recursos` | Jurídico |
| 8 | `homologado` | Gestão |

**Estados terminais (5):** `ganho` · `perdido` · `inabilitado` · `revogado` · `nao_participamos`

Um edital em `homologado` com resultado `ganho` dispara (Fase 10) o handoff automático para o SaaS de contratos via API.

**Gates por stage** — checklist tipado que o operador confere antes de avançar:

| Stage | Gates mínimos |
|---|---|
| `identificacao` | edital baixado, órgão identificado, vendedor atribuído |
| `analise` | análise comercial concluída, análise jurídica concluída |
| `pre_disputa` | prazo de esclarecimento / impugnação verificado, documentos redigidos |
| `proposta` | proposta técnica redigida, proposta comercial precificada |
| `disputa` | credenciamento no portal, proposta enviada |
| `habilitacao` | kit de habilitação completo, certidões válidas |
| `recursos` | prazo de recurso verificado, contrarrazões redigidas (se necessário) |
| `homologado` | ata de homologação salva no Drive |

**Mapeamento do checklist do Trello:**

| Item Trello | Stage correspondente | Observação |
|---|---|---|
| Em análise | `analise` | |
| Pedido de Esclarecimento | `pre_disputa` | |
| Impugnação | `pre_disputa` | |
| Cadastrar Proposta | `proposta` | |
| Em recurso | `recursos` | |
| Enviar Contrarrazões | `recursos` | |
| Habilitação Original Enviada | `habilitacao` | |
| Aguardando Ata/Contrato | `homologado` | |
| Aguardando Empenho | — | → SaaS de contratos |
| Empenho Recebido | — | → SaaS de contratos |
| Material Entregue | — | → SaaS de contratos |

**Páginas do frontend:**
- `/` — visão pipeline (colunas por stage, cards resumidos)
- `/edital/[id]` — edital completo: análises + comentários + Drive + movimentação
- `/upload` — upload do edital → cria registro → roda pipeline
- `/historico` — busca/filtro (status, órgão, UF, vendedor, data)
- `/config` — prompt customizável por usuário
- `/admin` — monitoramento + editor de súmulas (`/admin/sumulas`)

---

### 6.5 Base de conhecimento jurídico

| Arquivo | Localização | Responsável |
|---|---|---|
| `lei_14133.txt` | `backend/knowledge/lei_14133.txt` | Dev (arquivo já disponível na raiz) |
| `tcu_sumulas.yaml` | `backend/knowledge/tcu_sumulas.yaml` | Amália + jurídico (ver §6.6) |

**Súmulas prioritárias (mínimo 8 para o MVP):**

1. Somatório de atestados (art. 67 + Acórdão 2.150/2015-Plenário)
2. Parcelas de maior relevância (art. 67 §1º — 4% do valor estimado)
3. Restrição temporal de atestados (art. 67 §2º — vedada)
4. Restrição local (art. 67 §2º — vedada)
5. Capital mínimo / patrimônio líquido (art. 69 §4º — ≤10% do valor estimado)
6. Índices de rentabilidade/lucratividade (art. 69 §2º — vedados)
7. Garantia contratual (art. 96 — ≤5%, regra + exceções)
8. Cláusulas direcionadoras de marca (art. 42)

---

### 6.6 Estratégia de curadoria do `tcu_sumulas.yaml`

#### Caminho B — YAML no git, curadoria assistida por IA *(escolha para o MVP)*

Fluxo:
1. Amália (ou jurídico) cola o texto bruto do acórdão TCU num prompt
2. IA retorna rascunho estruturado no schema YAML
3. Humano revisa, ajusta 1–2 frases, cola no arquivo
4. `git commit` — hash do commit = `knowledge_version` de cada análise

**Prompt de curadoria:**

```
Você é um especialista em Lei 14.133/2021 e jurisprudência do TCU.
Recebeu um acórdão TCU. Extraia UMA súmula aplicável em licitações de TI,
no formato YAML abaixo. Seja preciso: cite artigos literais, sem inventar.

Acórdão: [cola o texto]

Formato:
- id: TCU-S-XXX
  tema: ...
  enunciado: >
    (2-3 linhas — qual o posicionamento do TCU sobre isso)
  base_legal: [...]
  implicacao_pratica: >
    (quando um edital viola isso, o que o licitante faz)
  aplicacao_ti: true|false
  acordaos_referencia: ["..."]
```

Custo estimado: 1 acórdão → 5 min. 8 acórdãos → 1 tarde.

#### Caminho C — Postgres editável + versionamento *(migração futura — Fase 8.5)*

Como `tcu_sumulas` já está no Postgres, a evolução natural é uma UI CRUD — sem Firestore, sem Cloud Function, sem GCS bucket extra.

```
Cloud SQL Postgres: tcu_sumulas (source of truth)
  ← jurídico edita via UI /admin/sumulas
  ← trigger PostgreSQL: INSERT em tcu_sumulas_historico antes de cada UPDATE
       (append-only automático)
```

Runtime Analista Licitatório (Fase 8.5): lê `tcu_sumulas WHERE ativo = true` → calcula hash SHA-256 dos registros → injeta no prompt → salva hash em `analises_juridicas.knowledge_version`.

UI `/admin/sumulas`: lista ativa · toggle ativo/inativo · histórico de edições (`tcu_sumulas_historico`) · assistente IA embutido (cola acórdão → estrutura automaticamente → humano revisa → salva).

#### Decisão registrada

| | Caminho B (MVP) | Caminho C (Fase 8.5) |
|---|---|---|
| **Quando** | Agora, antes da Fase 5 | Após 2–3 meses em produção |
| **Responsabilidade** | "Jurídico sugere → Xertica aprova → commit" — linha clara | Requer NDA/contrato explícito antes de dar edição direta |
| **Isolamento de regressão** | YAML estável → se minuta piorar, causa é o prompt | Postgres com trigger `tcu_sumulas_historico` → alterações rastreáveis |
| **Esforço** | Zero (arquivo + commit) | Tela CRUD (Postgres já existe, sem Cloud Function nem GCS extra) |

**Motivo para não fazer C agora:** 8 súmulas não justificam UI CRUD. Faça C quando souber quais súmulas mudam frequentemente — só visível após uso real.

---

### 6.7 Gerador de Documentos e Declarações

`backend/agents/gerador_documentos.py` — complementa o Analista Licitatório, não o substitui.

O pipeline, ao final, produz dois grupos de documentos:

**Grupo A — Documentos pré-sessão** (do Bloco 4 `DocumentosProtocolo`):
Minutas individualizadas para o edital — impugnação e/ou esclarecimento com texto formal completo, prazo calculado e base legal. Não são templates: o Gemini Pro redige o texto a partir da cláusula identificada.

**Grupo B — Declarações padrão** (geradas automaticamente em todo processo):
Combina dados fixos da Xertica (de `xertica_profile.yaml`: CNPJ, razão social, representante legal) com dados do edital (órgão, UASG, número do pregão, objeto, data), preenchendo templates pré-fixados. O jurídico não redige — só revisa, imprime em papel timbrado e assina.

| Declaração | Base legal | Quando gerar |
|---|---|---|
| Não emprega menor | art. 7º XIV CF + art. 68 V Lei 14.133 | Todo processo |
| Idoneidade | art. 68 I Lei 14.133 | Todo processo |
| Cumprimento dos requisitos de habilitação | art. 69 Lei 14.133 | Todo processo |
| Inexistência de fato superveniente impeditivo | art. 68 II Lei 14.133 | Todo processo |
| Pleno conhecimento das condições | cláusula usual | Se edital exigir (detectado pelo Analista) |
| Autenticidade dos documentos | cláusula usual | Se edital exigir |
| Vínculo dos técnicos designados | cláusula usual | Se edital exigir responsáveis técnicos nominados |
| Carta de credenciamento | usual em presencial | Se sessão for presencial |

**Formato de saída:**

| Fase | Formato | Como chega ao jurídico |
|---|---|---|
| MVP (Fases 5–7) | `text/plain` (markdown formatado) | Exibido no edital, botão "Copiar" |
| Fase 8 | Google Docs API | Criado automaticamente em `Habilitação/` no Drive do processo |

> **Humano no loop:** declarações são sugestão. Jurídico revisa, imprime em papel timbrado e assina. O agente só preenche — a responsabilidade jurídica é do assinante.

**Adições necessárias ao `xertica_profile.yaml`** (campos novos, antes da Fase 5):

```yaml
empresa:
  cnpj: "XX.XXX.XXX/XXXX-XX"
  razao_social: "Xertica Tecnologia Ltda"
  endereco: "..."
  representante_legal: "Nome Completo"
  cargo_representante: "Diretor"
  cpf_representante: "XXX.XXX.XXX-XX"
```

---

## 7. Schemas

### 7a. Cloud SQL Postgres (estado operacional)

> **Fonte de verdade para tudo que muda frequentemente.** Writes ACID, queries de baixa latência, conexões pooláveis. Datastream CDC replica tudo para BQ automaticamente.

**Instance:** `operaciones-br / us-central1` · `db-g1-small` (~US$40/mês) · Postgres 16

#### `editais` (tabela principal)

PK: `edital_id` (UUID). Índices: `(fase_atual, uf)`, `(vendedor_email)`, `(data_encerramento)`.

```sql
edital_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
orgao              TEXT NOT NULL,
uf                 CHAR(2) NOT NULL,
uasg               TEXT,
numero_pregao      TEXT,
portal             TEXT,
objeto             TEXT,
valor_estimado     NUMERIC(15,2),
data_encerramento  TIMESTAMPTZ,
fase_atual         TEXT NOT NULL DEFAULT 'identificacao',
  -- valores: identificacao | analise | pre_disputa | proposta |
  --          disputa | habilitacao | recursos | homologado
estado_terminal    TEXT,
  -- valores: ganho | perdido | inabilitado | revogado | nao_participamos
vendedor_email     TEXT,
drive_folder_id    TEXT,
drive_folder_url   TEXT,
analysis_id_comercial UUID,
analysis_id_juridica  UUID,
classificacao      TEXT,
risco              TEXT,
prioridade         INTEGER DEFAULT 3,
criado_por         TEXT NOT NULL,
criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `edital_movimentacoes`

```sql
mov_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
edital_id     UUID NOT NULL REFERENCES editais(edital_id),
fase_origem   TEXT NOT NULL,
fase_destino  TEXT NOT NULL,
autor_email   TEXT NOT NULL,
motivo        TEXT,
criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `edital_comentarios`

```sql
comentario_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
edital_id      UUID NOT NULL REFERENCES editais(edital_id),
autor_email    TEXT NOT NULL,
texto          TEXT NOT NULL,  -- markdown
mencionados    TEXT[],
criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `edital_gates`

```sql
gate_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
edital_id     UUID NOT NULL REFERENCES editais(edital_id),
stage         TEXT NOT NULL,
gate_key      TEXT NOT NULL,   -- ex: 'edital_baixado'
concluido     BOOLEAN NOT NULL DEFAULT false,
concluido_em  TIMESTAMPTZ,
concluido_por TEXT,
UNIQUE (edital_id, stage, gate_key)
```

#### `tcu_sumulas`

```sql
sumula_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
id_legado          TEXT UNIQUE NOT NULL,  -- ex: 'TCU-S-001'
tema               TEXT NOT NULL,
enunciado          TEXT NOT NULL,
base_legal         TEXT[],
implicacao_pratica TEXT,
aplicacao_ti       BOOLEAN NOT NULL DEFAULT true,
acordaos_ref       TEXT[],
ativo              BOOLEAN NOT NULL DEFAULT true,
criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `tcu_sumulas_historico` (append-only via trigger)

```sql
hist_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
sumula_id     UUID NOT NULL,
snapshot_json JSONB NOT NULL,
alterado_por  TEXT,
alterado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `atestados_cache`

```sql
cache_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
edital_id     UUID NOT NULL REFERENCES editais(edital_id),
categoria     TEXT NOT NULL,
volume_total  NUMERIC(15,2),
atestados_ids JSONB,
calculado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
```

#### `usuarios`

```sql
usuario_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
email       TEXT UNIQUE NOT NULL,
nome        TEXT,
papel       TEXT NOT NULL DEFAULT 'vendedor',
  -- valores: juridico | vendedor | diretor | admin
ativo       BOOLEAN NOT NULL DEFAULT true,
criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

### 7b. BigQuery (analytics — somente leitura pelo app)

> **Fonte de verdade analítica.** Nenhuma tabela BQ é escrita diretamente pelo backend de forma operacional. As tabelas `editais`, `edital_movimentacoes`, etc. chegam via Datastream CDC. As análises são escritas pelo Persistor após cada pipeline.

**Dataset:** `operaciones-br.lici_adk`

#### `analises_editais` (já existe — lici-adk v1)

Migração: `ALTER TABLE analises_editais ADD COLUMN edital_id STRING`.
Particionada por `data_analise`, clusterizada por `[uf, portal, status]`.

#### `analises_juridicas` (nova)

`analysis_id`, `data_analise`, `edital_id`, `user_email`, `conformidade_geral`, `score_conformidade`, `nivel_risco`, `minutas_count`, `relatorio_json`, `knowledge_version` (SHA-256 dos registros `tcu_sumulas` usados), `pipeline_ms`, `custom_prompt_used`.

Particionada por `data_analise`, clusterizada por `[edital_id, nivel_risco]`.

#### `documentos_protocolo` (nova — extraído de `relatorio_json`)

`doc_id`, `analysis_id`, `edital_id`, `tipo` (`ESCLARECIMENTO` | `IMPUGNACAO`), `topico`, `numero_clausula`, `prazo_limite`, `texto_formal`, `base_legal`, `criado_em`.

Separa o que estava embutido em `relatorio_json` STRING — permite consultas analíticas ("quais cláusulas mais impugnadas?", "taxa de impugnação por portal?").

#### `eventos_pipeline` (nova — observabilidade)

`evento_id`, `edital_id`, `agente` (`extrator` | `qualificador` | `analista_comercial` | `analista_licitatorio` | `persistor`), `status` (`ok` | `erro`), `latencia_ms`, `tokens_input`, `tokens_output`, `erro_msg`, `criado_em`.

#### Configuração Datastream

```
Source: Cloud SQL Postgres (operaciones-br)
Dest:   BigQuery dataset lici_adk
Tabelas replicadas: editais, edital_movimentacoes, edital_comentarios,
                    edital_gates, tcu_sumulas, usuarios
Modo: CDC (Change Data Capture) — latencia ~1 min
```



---

## 8. API Contract

### Editais

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/editais` | Body: multipart (pdf, drive_folder_id?, vendedor_email?). Retorna `{edital_id, status}` |
| `GET` | `/editais` | Query: `fase`, `uf`, `vendedor_email`, `since`, `limit` |
| `GET` | `/editais/{id}` | Edital + análise comercial + jurídica (se existir) + comentários + movimentações |
| `PATCH` | `/editais/{id}` | Atualiza `fase`, `estado_terminal`, `vendedor`, `classificacao`, `risco` |
| `DELETE` | `/editais/{id}` | Soft delete |

> **Alias legado:** `POST /cards` → alias de `POST /editais` para não quebrar scripts existentes.

### Comentários

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/editais/{id}/comentarios` | Body: `{texto, mencionados}` |
| `GET` | `/editais/{id}/comentarios` | Lista |

### Gates

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/editais/{id}/gates` | Lista gates do stage atual |
| `PATCH` | `/editais/{id}/gates/{gate_key}` | Marca gate como concluído |

### Análises

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/editais/{id}/analise_juridica` | Dispara on-demand |
| `GET` | `/editais/{id}/analise_juridica` | Retorna `RelatorioLicitatorio` quando pronto |

### Drive

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/editais/{id}/drive/arvore` | Lista pastas e arquivos |
| `POST` | `/editais/{id}/drive/upload` | `file` + `subpasta_destino` → sobe no Drive |
| `POST` | `/editais/{id}/drive/sincronizar` | Força re-scan + atualiza cache |
| `GET` | `/editais/{id}/drive/atestados_somados` | Retorna somatório com `kit_minimo_recomendado` e referências nominais dos arquivos |

### Kit de Habilitação e Documentos

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/editais/{id}/kit_habilitacao` | Retorna Bloco 6 (`KitHabilitacao`) — atestados recomendados + certidões + gap |
| `GET` | `/editais/{id}/documentos` | Lista todos os documentos gerados (Bloco 4 + declarações do Grupo B) |
| `GET` | `/editais/{id}/documentos/{tipo}` | `tipo`: `impugnacao` \| `esclarecimento` \| `declaracoes` \| `kit` — retorna texto pronto para copiar |

**Auth:** todos exceto `/healthz` exigem SA ID token do frontend + header `X-User-Email` (`@xertica.com` + allowlist).

---

## 9. Roadmap

### Fase 1 — lici-adk core *(EM ANDAMENTO)*

- [x] Extrator, Qualificador, Analista Comercial, Persistor em Python puro
- [x] E2E PRODESP validado (score 73, APTO COM RESSALVAS, 347s, 11 evidências)
- [ ] E2E Celepar (strict_match, temporal 36m, glosa 50%)
- [ ] Gate de qualidade: comparar PRODESP + Celepar → se bom, segue Fase 2

### Fase 2 — Refactor para ADK

- [ ] `orchestrator.py` Python puro → `SequentialAgent(google-adk)`
- [ ] Prompts inalterados, só estrutura muda
- [ ] Rerodar PRODESP + Celepar e comparar
- [ ] Renomear `analista.py` → `analista_comercial.py`, `ParecerFinal` → `ParecerComercial`

### Fase 3 — Deploy limpo em operaciones-br

- [ ] Build + deploy `x-lici-backend` em `operaciones-br/us-central1`
- [ ] Provisionar **Cloud SQL Postgres 16** (`db-g1-small`, us-central1) + VPC connector
- [ ] IAM: `roles/aiplatform.user` + BQ + `run.invoker` + `cloudsql.client` para SA backend
- [ ] Smoke test E2E via HTTPS autenticado
- [ ] Remover tabelas `cards`, `card_comentarios`, `card_movimentacoes` do BQ (substituídas por Cloud SQL + Datastream)

### Fase 4 — Somador de Atestados + Drive read-only

- [ ] SA com Drive API + Domain-Wide Delegation configurada
- [ ] Tool `somar_atestados_do_drive(edital_id)` (Gemini Flash extrai de cada PDF)
- [ ] Cache `atestados_cache` em Postgres (invalidação automática)
- [ ] Analista Comercial consome somatório antes de declarar gap

### Fase 5 — Analista Licitatório

> **Pré-condição:** `tcu_sumulas.yaml` com ≥ 8 súmulas revisadas (Amália + jurídico, §6.6 Caminho B).

- [ ] `backend/knowledge/lei_14133.txt` (mover da raiz)
- [ ] `backend/knowledge/tcu_sumulas.yaml` curado via Caminho B
- [ ] `backend/agents/analista_licitatorio.py` — 6 blocos: FichaProcesso + AtestadoAnalise + RiscoJuridico + DocumentosProtocolo (**ESCLARECIMENTO** | **IMPUGNACAO** com prazos calculados) + CardExecutivo + KitHabilitacao
- [ ] `backend/agents/gerador_documentos.py` — declarações padrão preenchidas com dados de `xertica_profile.yaml`
- [ ] Campos empresa adicionados ao `xertica_profile.yaml` (CNPJ, representante legal, cargo, CPF)
- [ ] Schemas `RelatorioLicitatorio` + 6 sub-blocos em `schemas.py`
- [ ] Endpoint `POST /editais/{id}/analise_juridica` + tabela `analises_juridicas` em BQ
- [ ] Endpoints `GET /editais/{id}/kit_habilitacao` + `GET /editais/{id}/documentos/{tipo}`
- [ ] Teste com edital Celepar: deve gerar IMPUGNAÇÃO (strict_match) + kit de atestados com `drive_file_name` + declarações preenchidas

### Fase 6 — Sistema de Controle de Editais

- [ ] Schemas Cloud SQL: `editais`, `edital_movimentacoes`, `edital_comentarios`, `edital_gates`, `usuarios`
- [ ] Datastream CDC configurado: Cloud SQL → BQ `lici_adk`
- [ ] Endpoints `/editais/*` completos (stages, gates, comentários)
- [ ] `POST /editais` orquestra: Extrator → 2 analistas em paralelo → Persistor
- [ ] Migração: `analises_editais ADD COLUMN edital_id`
- [ ] `tcu_sumulas` migradas do YAML para tabela Postgres

### Fase 7 — Frontend Next.js (identidade Xertica)

- [ ] Scaffold Next.js 14 + Tailwind tokens brand kit + shadcn/ui + MUI Icons
- [ ] NextAuth Google Provider (`hd=xertica.com`)
- [ ] Dark mode · paletas · Poppins + Roboto via `next/font`
- [ ] Páginas: `/` · `/edital/[id]` · `/upload` · `/historico` · `/config` · `/admin`
- [ ] Deploy Cloud Run `x-lici-web` em `operaciones-br/us-central1`

### Fase 8 — Drive read-write + Upload inteligente

- [ ] `POST /editais/{id}/drive/upload` roteia para subpasta correta
- [ ] Detector de tipo via Gemini Flash (edital → `Edital/`, atestado → `Atestados/`)
- [ ] Notificação no edital quando jurídico sobe arquivo direto no Drive

### Fase 8.5 — Knowledge base: Caminho B → Caminho C

> Executar somente após 2–3 meses em produção e com >8 súmulas ativas.

- [ ] UI `/admin/sumulas`: CRUD em Postgres + assistente IA embutido + histórico via `tcu_sumulas_historico`
- [ ] Backend: leitura `tcu_sumulas WHERE ativo = true` em runtime + hash SHA-256 calculado dinâmico
- [ ] `analises_juridicas.knowledge_version` passa a ser hash calculado dos registros Postgres
- [ ] (Opcional) Export snapshot diário → GCS como backup cold

### Fase 9 — Admin / Observabilidade

- [ ] `/admin`: latência por agente, taxa APTO, score médio, editais/semana, editais por stage
- [ ] Pipeline visual por edital
- [ ] Logs Cloud Logging → SSE

### Fase 10 — Integrações e V2

- [ ] **Integração SaaS de contratos:** handoff automático quando `estado_terminal = ganho` — POST webhook para SaaS com dados do edital + análise comercial + kit de habilitação
- [ ] Notificações Google Chat (edital próximo do vencimento)
- [ ] Alerta proativo por novo edital no PNCP
- [ ] Agente 5: geração de minuta de proposta técnica

---

## 10. Decisões de arquitetura

| Decisão | Valor | Motivo |
|---|---|---|
| Projeto único | `operaciones-br` | Amália é Owner, zero dependência externa |
| Região | `us-central1` | Gemini 2.5 Pro + custo |
| Orquestração | ADK `SequentialAgent` na Fase 2 | Padrão Google |
| Auth | Google OAuth `@xertica.com` | NextAuth + SA token service-to-service |
| Drive fonte da verdade | Read-only no MVP | Zero fricção com jurídico |
| Knowledge jurídico | In-context (lei + YAML curado) | 150 KB cabe em 1 M tokens do Pro, zero RAG |
| Estado operacional | **Cloud SQL Postgres 16** | ACID, writes frequentes, baixa latência; BQ via Datastream |
| Analytics | **BigQuery** somente | Warehouse imutável; `analises_editais`, `analises_juridicas`, `documentos_protocolo`, `eventos_pipeline` |
| Firestore | **Eliminado** | Cloud SQL cobre tudo; menos serviços, menos custo |
| Datastream CDC | Cloud SQL → BQ | Sincronização automática, sem ETL manual |
| Controle de editais | **8 stages + 5 estados terminais** | Pipeline licitatório real (não kanban genérico) |
| Fronteira x-lici | termina em `homologado` | Pós-homologação (empenho, entrega, contrato) → SaaS de contratos (Fase 10) |
| `documentos_protocolo` | Tabela BQ separada | Extrai de `relatorio_json`; habilita analytics sobre impugnações |
| `knowledge_version` | SHA-256 dos registros `tcu_sumulas` | Rastreabilidade por análise; não depende de hash de arquivo |
| Backend único | Sim | Um só FastAPI, zero duplicação |
| Somador de atestados | Novo, crítico | Diferencial vs ferramentas genéricas |
| Analista Licitatório | Separado do Comercial | Dois papéis, dois prompts, mesmo Extrator |
| Sem `--allow-unauthenticated` | Frontend SSR injeta token | Segurança via IAM |
| `tcu_sumulas` — MVP | Caminho B (YAML + git + IA) → migrar para Postgres na Fase 6 | 8 súmulas não justificam UI CRUD antes da estabilização |
| `tcu_sumulas` — V2 | Caminho C (UI CRUD em Postgres) | Fase 8.5 — após estabilização; sem Firestore |
| Identidade visual | Brand kit Xertica v.2 | Produto com cara de produto |
| Impugnação vs Esclarecimento | Documentos distintos via campo `tipo` com prazos diferenciados | Art. 164 *caput* (impugnação −3 dias úteis) ≠ art. 164 §1º (esclarecimento −5 dias úteis); efeitos jurídicos diferentes |
| Prazos calculados automaticamente | Sim, a partir de `data_encerramento` no Bloco 1 | Evita erro humano de contar prazo errado |
| Kit de habilitação | Bloco 6 do Analista Licitatório | Jurídico recebe lista nominal de atestados + certidões faltantes em vez de montar manualmente |
| Atestados referenciados por nome + file_id | Sim — somatório retorna `drive_file_name` e `drive_file_id` por atestado | Jurídico sabe exatamente qual PDF incluir no envelope |
| Declarações padrão | Geradas automaticamente via templates + `xertica_profile.yaml` | Elimina retrabalho repetido em todo certame; jurídico só revisa e assina |
| Formato de documentos no MVP | `text/plain` no edital (botão Copiar) | Zero dependência de Docs API no MVP; migra para Google Docs API na Fase 8 |

---

## 11. O que a Amália precisa fazer manualmente

### Ações GCP

1. Habilitar **Drive API** no projeto (`gcloud services enable drive.googleapis.com`)
2. Habilitar **Datastream API** (`gcloud services enable datastream.googleapis.com`)
3. **Domain-Wide Delegation** para a SA no Workspace Admin
4. Criar pasta `Xertica Licitações/` no Drive e compartilhar com a SA
5. (Fase 3) Provisionar Cloud SQL Postgres 16 + VPC connector + SA com `cloudsql.client`
6. (Fase 7) OAuth 2.0 client para NextAuth — JS origins + redirect URIs

### Conteúdo jurídico

7. **Curar `tcu_sumulas.yaml`** antes da Fase 5 — 8 súmulas via prompt do §6.6 Caminho B
8. **Validar 1–2 minutas** geradas pelo Analista Licitatório com o jurídico antes do rollout

### Operacional

7. **Padronizar estrutura de pastas no Drive** (subpastas com nomes exatos: `Edital`, `Atestados`, `Habilitação`, `Proposta`, `Contrato`). `Atestados/` é crítica.
8. **Definir lista de emails autorizados** (jurídico + vendedores + diretoria) → allowlist de auth

---

## 12. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Jurídico resiste à mudança | Alto | Drive continua como ferramenta deles. App read-only no MVP. |
| Domain-Wide Delegation negada | Médio | Fallback: SA com acesso direto à pasta compartilhada |
| Somador extrai volume errado | Alto | Dry-run com 10+ atestados reais antes de confiar |
| Minuta jurídica com erro grave | Crítico | **Humano no loop obrigatório:** minuta é sugestão, jurídico aprova antes de protocolar |
| Declaração gerada com dados incorretos | Alto | `xertica_profile.yaml` precisa ter CNPJ, representante e cargo atualizados antes do primeiro uso |
| Prazo calculado desconsiderando feriados | Médio | Motor de dias úteis usa calendário federal; MVP pode adotar dias corridos como fallback conservador (jurídico valida) |
| Analista Licitatório alucina artigo da lei | Alto | Lei 14.133 in-context como grounding. Log de artigos citados por análise. |
| LGPD — jurídico terceirizado acessa dados Xertica | Médio | NDA formalizado. Allowlist. Audit log de acesso. |
| Caminho C sem NDA formalizado | Médio | Responsabilidade ambígua → só migrar para C depois de NDA + produto estável |
| Cloud SQL connection pool saturado | Médio | Cloud Run max-instances + pgBouncer; upgrade para `db-custom-1-3840` se necessário |
| Cloud SQL indisponível (manutenção GCP) | Baixo | Habilitar HA (regional replica) antes de ir para produção real |
| Pasta Drive cresce e inviabiliza sync | Baixo no MVP | Sync incremental por timestamp. Fallback: GCS espelhado. |

---

## 13. Métricas de sucesso

### Fases 5–6 (MVP)

- Jurídico processa ≥ 5 editais no app em 2 semanas sem pedir para voltar ao Trello
- Minuta de esclarecimento aprovada com ≤ 30% de edição
- Vendedor consulta edital antes de enviar proposta em ≥ 80% dos casos

### Fase 8+ (maturidade)

- 100% dos editais entram pelo app (Trello descontinuado)
- Tempo médio "recebimento do edital → decisão de participar" cai pela metade
- Taxa de inabilitação por questão técnica identificada pelo app cai

---

## 14. Histórico de decisões

| Data | Evento |
|---|---|
| 2026-04-17 | lici-adk v1 deployado em `xertica-gen-ai-br`. E2E PRODESP validado (score 73, 347s). |
| 2026-04-18 | x-biding v0.1 rascunhado como produto paralelo. Revisão identificou `--allow-unauthenticated` inaceitável, acoplamento de backend frágil, timing prematuro. |
| 2026-04-18 | Usuário confirmou: operador real é o jurídico; produto substitui Trello; Drive é fonte de verdade. |
| 2026-04-18 | Consolidação: lici-adk + x-biding → **x-lici** (produto único). Brand Kit v.2 (navy `#14263D`, 4 paletas, Poppins/Roboto). Drive read-only no MVP. Somador de atestados como feature crítica. |
| 2026-04-18 | Estratégia de curadoria de súmulas formalizada: Caminho B (YAML + IA) no MVP → Caminho C (UI CRUD em Postgres) na Fase 8.5. |
| 2026-04-18 | Analista Licitatório expandido para 6 blocos: Bloco 4 renomeado para `DocumentosProtocolo` com distinção ESCLARECIMENTO/IMPUGNACAO e prazos calculados. Bloco 6 `KitHabilitacao` adicionado com referências nominais do Drive. Novo §6.7 Gerador de Declarações padrão (Grupo A + B). Somador expandido com `drive_file_name`, `drive_file_id` e `kit_minimo_recomendado`. |
| 2026-04-18 | **v2.3 — Decisão: Cloud SQL Postgres 16 substitui BQ/Firestore para estado operacional.** Datastream CDC replica Cloud SQL → BQ automaticamente. Firestore eliminado. `tcu_sumulas` migra para tabela Postgres com trigger append-only `tcu_sumulas_historico`. BQ fica apenas para: `analises_editais`, `analises_juridicas`, `documentos_protocolo`, `eventos_pipeline`. |
| 2026-04-18 | **v2.3 — Reframe: "Kanban" → "Sistema de Controle de Editais"** com 8 stages (`identificacao → analise → pre_disputa → proposta → disputa → habilitacao → recursos → homologado`) + 5 estados terminais (`ganho \| perdido \| inabilitado \| revogado \| nao_participamos`). Fronteira x-lici: termina em `homologado`. Pós-homologação vai para SaaS de contratos (Fase 10, integração a definir). Fase 6 renomeada. |

---

## 15. Próximos passos concretos

**Duas frentes paralelas que destravam a Fase 5:**

**Frente A — Amália (1–2 dias):**
1. E2E Celepar → fecha Fase 1
2. Curar 8 súmulas via prompt do §6.6 → `git commit backend/knowledge/tcu_sumulas.yaml`
3. Padronizar pastas Drive em 2–3 processos recentes

**Frente B — Dev (paralelo, não bloqueia Frente A):**
4. Fase 2 — refactor para ADK
5. Fase 4 — somador de atestados + Drive API read-only

A Fase 5 (Analista Licitatório) só começa quando `tcu_sumulas.yaml` estiver pronto. Frente A desbloqueia Frente B nesse ponto.

---

> **Duas observações honestas:**
>
> 1. **Cronograma realista: 8–12 semanas** de trabalho focado. Isso é uma plataforma, não um MVP de 4 agentes.
> 2. **`tcu_sumulas.yaml` é a dependência mais crítica.** Se as súmulas estiverem rasas, as minutas vão ser ruins e o jurídico vai desconfiar do produto. Fazer com o jurídico terceirizado transforma eles em co-autores e reduz resistência política.

---

*Versão: v2.3 · 2026-04-18*
*Canônico a partir desta data — substitui x-biding v0.1 completamente.*
*Conflita com `architecture.md` apenas no nome: lici-adk é o motor; x-lici é o produto.*
