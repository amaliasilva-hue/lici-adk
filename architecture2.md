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
| Operacional | "Em que fase está? Quem é responsável? O que falta?" | A construir — kanban, cards, comentários, anexos, integração Drive |

- **Usuário primário:** jurídico terceirizado (o operador que movimenta cards)
- **Usuário secundário:** vendedor / Customer Engineer (vinculado a cards, comenta, aprova)
- **Usuário terciário:** diretoria (vê pipeline agregado)
- **Substitui:** o Trello atual. Sem coexistência.

---

## 2. Princípios arquiteturais (trava contra escopo mutante)

1. **Drive é fonte de verdade da operação jurídica.** O app lê do Drive via Drive API. Nunca sobrescreve. Jurídico continua operando como hoje.
2. **BigQuery é fonte de verdade do histórico e analytics.** Toda análise persiste em `operaciones-br.lici_adk.*`.
3. **Um backend só.** FastAPI único em Cloud Run, projeto `operaciones-br`. Endpoints novos se somam aos existentes.
4. **Um frontend só.** Next.js em Cloud Run, servindo kanban, análise, histórico, config. Identidade visual Xertica (brand kit oficial).
5. **Extrator é compartilhado.** O lici-adk já extrai o edital estruturado. O Analista Comercial e o Analista Licitatório consomem o mesmo output.
6. **Auth Google OAuth @xertica.com.** Jurídico terceirizado recebe conta `@xertica.com` pelo Workspace ou acesso controlado por email whitelist.
7. **Sem `--allow-unauthenticated`.** Cloud Run autenticado. Frontend SSR injeta token service-to-service. Zero exposição pública.

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
│    /           Kanban (fases do processo, cards por edital)           │
│    /card/[id]  Card: análise comercial + jurídica + comentários +     │
│                anexos (espelhados do Drive) + movimentação            │
│    /upload     Upload do edital → cria card → roda pipeline           │
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
│  ENDPOINTS — CARDS                                                     │
│    POST /cards                       cria card (dispara pipeline)    │
│    GET  /cards · GET /cards/{id}     lê estado do card               │
│    PATCH /cards/{id}                 atualiza fase/vendedor/campos    │
│    POST /cards/{id}/comentarios      adiciona comentário             │
│    POST /cards/{id}/analise_juridica dispara Analista Licitatório    │
│                                                                        │
│  ENDPOINTS — DRIVE                                                     │
│    GET  /cards/{id}/drive/arvore           lista pastas/arquivos     │
│    POST /cards/{id}/drive/upload           upload → subpasta certa   │
│    POST /cards/{id}/drive/sincronizar      força re-scan             │
│    GET  /cards/{id}/drive/atestados_somados  somatório               │
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
│            └─ atestados ──────▶ │  TCU súmulas +      │    5 blocos  │
│               somados           │  custom_prompt)     │              │
│                                 └─────────────────────┘              │
│                                           │                           │
│                                           ▼                           │
│                           ┌─────────────────────────┐                │
│                           │ Persistor               │                │
│                           │ (card + 2 análises)     │                │
│                           └─────────────────────────┘                │
└───┬────────────────────┬─────────────────────────┬───────────────────┘
    │ Vertex AI          │ BigQuery                │ Drive API
    ▼                    ▼                         ▼
┌──────────────┐  ┌─────────────────────┐  ┌────────────────────────┐
│ Gemini 2.5   │  │ operaciones-br      │  │ Google Drive           │
│ Flash / Pro  │  │ .sales_intelligence │  │  Xertica Licitações/   │
└──────────────┘  │ .lici_adk:          │  │    [UF]/[Processo]/    │
                  │   .cards (nova)     │  │      ├─ Edital/        │
                  │   .card_comentarios │  │      ├─ Atestados/     │
                  │   .card_movimentac. │  │      ├─ Habilitação/   │
                  │   .analises_editais │  │      ├─ Proposta/      │
                  │   .analises_        │  │      └─ Contrato/      │
                  │     juridicas(nova) │  │                        │
                  │   .atestados_cache  │  │ read-only no MVP       │
                  └─────────────────────┘  └────────────────────────┘
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

`POST /analyze` vira alias de `POST /cards` — cria card automaticamente, devolve `analysis_id=card_id`.
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

**Solução:** tool `somar_atestados_do_drive(card_id)`:

1. Lê a subpasta `Atestados/` do card no Drive via Drive API
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

Sincronização no MVP: background job a cada 15 min verificando timestamp; arquivo novo → re-processa somatório + notifica card.

**Autenticação Drive:**
- SA do backend com Domain-Wide Delegation — impersona o email do usuário do request
- Fallback: SA com acesso direto às pastas compartilhadas (se DWD não for aprovado)

---

### 6.4 Kanban + Cards (substitui Trello)

**Colunas:**

1. Oportunidades
2. Em Análise Técnica
3. Em Análise Jurídica
4. Esclarecimento / Impugnação
5. Aprovado — Montar Processo
6. Aguardando Disputa
7. Em Recurso / Contrarrazões
8. Habilitação
9. Ganho
10. Perdido / Desclassificado

**Checklist no card** (11 itens do Trello → automatizados):
Em análise · Impugnação · Cadastrar Proposta · Pedido de Esclarecimento · Em recurso · Enviar Contrarrazões · Habilitação Original Enviada · Aguardando Ata/Contrato · Aguardando Empenho · Empenho Recebido · Material Entregue.

**Campos do card** (`lici_adk.cards`): `card_id`, `orgao`, `uf`, `uasg`, `numero_pregao`, `portal`, `objeto`, `valor_estimado`, `data_encerramento`, `prazo_questionamento`, `fase_atual`, `checklist_json`, `vendedor_email`, `drive_folder_id`, `drive_folder_url`, `analysis_id_comercial`, `analysis_id_juridica`, `classificacao`, `risco`, `prioridade`, `criado_por`, `criado_em`, `atualizado_em`.

**Comentários** (`card_comentarios`): `comentario_id`, `card_id`, `autor_email`, `texto` (markdown), `mencionados_json`, `criado_em`.

**Movimentações** (`card_movimentacoes`): `mov_id`, `card_id`, `fase_origem`, `fase_destino`, `autor_email`, `motivo`, `criado_em`.

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

#### Caminho C — Firestore editável + versionamento *(migração futura — Fase 8.5)*

```
Firestore: tcu_sumulas (source of truth)
  ← jurídico edita via UI /admin/sumulas
  ← append-only, updates com campo versao_anterior
       │
       │ backup diário (Cloud Function)
       ▼
GCS: gs://.../tcu_sumulas_snapshots/YYYY-MM-DD.yaml
```

Runtime Analista Licitatório (Fase 8.5): lê Firestore `where("ativo", true)` → calcula hash → injeta no prompt → salva hash em `analises_juridicas.knowledge_version`.

UI `/admin/sumulas`: lista ativa · toggle · histórico de edições · assistente IA embutido (cola acórdão → estrutura automaticamente → humano revisa → salva).

#### Decisão registrada

| | Caminho B (MVP) | Caminho C (Fase 8.5) |
|---|---|---|
| **Quando** | Agora, antes da Fase 5 | Após 2–3 meses em produção |
| **Responsabilidade** | "Jurídico sugere → Xertica aprova → commit" — linha clara | Requer NDA/contrato explícito antes de dar edição direta |
| **Isolamento de regressão** | YAML estável → se minuta piorar, causa é o prompt | Firestore mutável dificulta debugging |
| **Esforço** | Zero (arquivo + commit) | Tela CRUD + Cloud Function + GCS bucket |

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
| MVP (Fases 5–7) | `text/plain` (markdown formatado) | Exibido no card, botão "Copiar" |
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

## 7. Schemas BigQuery

> **Nota — BQ para estado de kanban:** BQ é otimizado para analytics, não writes frequentes.
> Para o MVP (<50 movimentações/dia) o padrão append-only funciona. **Trigger para reconsiderar:**
> se volume ultrapassar ~500 updates/dia ou latência de leitura do kanban ficar >2s, migrar
> estado operacional (`cards`, `comentarios`, `movimentacoes`) para Firestore — BQ continua como
> warehouse de histórico e analytics.

### `cards` (nova)

PK: `card_id`. Particionada por `criado_em`, clusterizada por `[fase_atual, uf, vendedor_email]`.

Campos: `card_id`, `orgao`, `uf`, `uasg`, `numero_pregao`, `portal`, `objeto`, `valor_estimado`, `data_encerramento`, `prazo_questionamento`, `fase_atual`, `checklist_json`, `vendedor_email`, `drive_folder_id`, `drive_folder_url`, `analysis_id_comercial`, `analysis_id_juridica`, `classificacao`, `risco`, `prioridade`, `criado_por`, `criado_em`, `atualizado_em`.

### `card_comentarios` (nova)

`comentario_id`, `card_id`, `autor_email`, `texto`, `mencionados_json`, `criado_em`.

### `card_movimentacoes` (nova)

`mov_id`, `card_id`, `fase_origem`, `fase_destino`, `autor_email`, `motivo`, `criado_em`.

### `analises_juridicas` (nova)

`analysis_id`, `data_analise`, `card_id`, `user_email`, `conformidade_geral`, `score_conformidade`, `nivel_risco`, `minutas_count`, `relatorio_json`, `knowledge_version` (hash do commit do `tcu_sumulas.yaml`), `pipeline_ms`, `custom_prompt_used`.

### `analises_editais` (já existe — lici-adk v1)

Migração: `ALTER TABLE analises_editais ADD COLUMN card_id STRING`.

### `atestados_somados_cache` (nova — performance)

`card_id`, `categoria`, `volume_total`, `atestados_ids_json`, `calculado_em`.
TTL: invalidar quando Drive detectar arquivo novo na subpasta `Atestados/`.

---

## 8. API Contract

### Cards

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/cards` | Body: multipart (pdf, drive_folder_id?, vendedor_email?). Retorna `{card_id, status}` |
| `GET` | `/cards` | Query: `fase`, `uf`, `vendedor_email`, `since`, `limit` |
| `GET` | `/cards/{id}` | Card + análise comercial + jurídica (se existir) + comentários + movimentações |
| `PATCH` | `/cards/{id}` | Atualiza `fase`, `vendedor`, `classificacao`, `risco` |
| `DELETE` | `/cards/{id}` | Soft delete |

### Comentários

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/cards/{id}/comentarios` | Body: `{texto, mencionados}` |
| `GET` | `/cards/{id}/comentarios` | Lista |

### Análises

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/cards/{id}/analise_juridica` | Dispara on-demand |
| `GET` | `/cards/{id}/analise_juridica` | Retorna `RelatorioLicitatorio` quando pronto |

### Drive

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/cards/{id}/drive/arvore` | Lista pastas e arquivos |
| `POST` | `/cards/{id}/drive/upload` | `file` + `subpasta_destino` → sobe no Drive |
| `POST` | `/cards/{id}/drive/sincronizar` | Força re-scan + atualiza cache |
| `GET` | `/cards/{id}/drive/atestados_somados` | Retorna somatório com `kit_minimo_recomendado` e referências nominais dos arquivos |

### Kit de Habilitação e Documentos

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/cards/{id}/kit_habilitacao` | Retorna Bloco 6 (`KitHabilitacao`) — atestados recomendados + certidões + gap |
| `GET` | `/cards/{id}/documentos` | Lista todos os documentos gerados (Bloco 4 + declarações do Grupo B) |
| `GET` | `/cards/{id}/documentos/{tipo}` | `tipo`: `impugnacao` \| `esclarecimento` \| `declaracoes` \| `kit` — retorna texto pronto para copiar |

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
- [ ] IAM: `roles/aiplatform.user` + BQ + `run.invoker` para Amália
- [ ] Smoke test E2E via HTTPS autenticado

### Fase 4 — Somador de Atestados + Drive read-only

- [ ] SA com Drive API + Domain-Wide Delegation configurada
- [ ] Tool `somar_atestados_do_drive(card_id)` (Gemini Flash extrai de cada PDF)
- [ ] Cache `atestados_somados_cache`
- [ ] Analista Comercial consome somatório antes de declarar gap

### Fase 5 — Analista Licitatório

> **Pré-condição:** `tcu_sumulas.yaml` com ≥ 8 súmulas revisadas (Amália + jurídico, §6.6 Caminho B).

- [ ] `backend/knowledge/lei_14133.txt` (mover da raiz)
- [ ] `backend/knowledge/tcu_sumulas.yaml` curado via Caminho B
- [ ] `backend/agents/analista_licitatorio.py` — 6 blocos: FichaProcesso + AtestadoAnalise + RiscoJuridico + DocumentosProtocolo (**ESCLARECIMENTO** | **IMPUGNACAO** com prazos calculados) + CardExecutivo + KitHabilitacao
- [ ] `backend/agents/gerador_documentos.py` — declarações padrão preenchidas com dados de `xertica_profile.yaml`
- [ ] Campos empresa adicionados ao `xertica_profile.yaml` (CNPJ, representante legal, cargo, CPF)
- [ ] Schemas `RelatorioLicitatorio` + 6 sub-blocos em `schemas.py`
- [ ] Endpoint `POST /cards/{id}/analise_juridica` + tabela `analises_juridicas`
- [ ] Endpoints `GET /cards/{id}/kit_habilitacao` + `GET /cards/{id}/documentos/{tipo}`
- [ ] Teste com edital Celepar: deve gerar IMPUGNAÇÃO (strict_match) + kit de atestados com `drive_file_name` + declarações preenchidas

### Fase 6 — Kanban + Cards + Comentários

- [ ] Tabelas BQ: `cards`, `card_comentarios`, `card_movimentacoes`
- [ ] Endpoints `/cards/*` completos
- [ ] `POST /cards` orquestra: Extrator → 2 analistas em paralelo → Persistor
- [ ] Migração: `analises_editais ADD COLUMN card_id`

### Fase 7 — Frontend Next.js (identidade Xertica)

- [ ] Scaffold Next.js 14 + Tailwind tokens brand kit + shadcn/ui + MUI Icons
- [ ] NextAuth Google Provider (`hd=xertica.com`)
- [ ] Dark mode · paletas · Poppins + Roboto via `next/font`
- [ ] Páginas: `/` · `/card/[id]` · `/upload` · `/historico` · `/config` · `/admin`
- [ ] Deploy Cloud Run `x-lici-web` em `operaciones-br/us-central1`

### Fase 8 — Drive read-write + Upload inteligente

- [ ] `POST /cards/{id}/drive/upload` roteia para subpasta correta
- [ ] Detector de tipo via Gemini Flash (edital → `Edital/`, atestado → `Atestados/`)
- [ ] Notificação no card quando jurídico sobe arquivo direto no Drive

### Fase 8.5 — Knowledge base: Caminho B → Caminho C

> Executar somente após 2–3 meses em produção e com >8 súmulas ativas.

- [ ] Criar coleção `tcu_sumulas` no Firestore + migrar súmulas do YAML
- [ ] Cloud Function: snapshot diário → GCS `tcu_sumulas_snapshots/`
- [ ] Backend: leitura Firestore em runtime + hash calculado dinâmico
- [ ] UI `/admin/sumulas`: CRUD + assistente IA embutido + histórico de edições
- [ ] `analises_juridicas.knowledge_version` passa a ser hash Firestore

### Fase 9 — Admin / Observabilidade

- [ ] `/admin`: latência por agente, taxa APTO, score médio, editais/semana, cards por fase
- [ ] Pipeline visual por card
- [ ] Logs Cloud Logging → SSE

### Fase 10 — V2

- [ ] Notificações Google Chat (card próximo do vencimento)
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
| Kanban | Custom no app, substitui Trello | Controle total + integração com IA |
| Backend único | Sim | Um só FastAPI, zero duplicação |
| Somador de atestados | Novo, crítico | Diferencial vs ferramentas genéricas |
| Analista Licitatório | Separado do Comercial | Dois papéis, dois prompts, mesmo Extrator |
| Sem `--allow-unauthenticated` | Frontend SSR injeta token | Segurança via IAM |
| BQ para estado kanban | Aceitável no MVP (<50 mov/dia) | Trigger documentado em §7 |
| `tcu_sumulas.yaml` — MVP | Caminho B (YAML + git + IA) | 8 súmulas não justificam UI CRUD; isolamento de regressão |
| `tcu_sumulas.yaml` — V2 | Caminho C (Firestore + UI) | Fase 8.5 — após estabilização |
| Identidade visual | Brand kit Xertica v.2 | Produto com cara de produto |
| Impugnação vs Esclarecimento | Documentos distintos via campo `tipo` com prazos diferenciados | Art. 164 *caput* (impugnação −3 dias úteis) ≠ art. 164 §1º (esclarecimento −5 dias úteis); efeitos jurídicos diferentes |
| Prazos calculados automaticamente | Sim, a partir de `data_encerramento` no Bloco 1 | Evita erro humano de contar prazo errado |
| Kit de habilitação | Bloco 6 do Analista Licitatório | Jurídico recebe lista nominal de atestados + certidões faltantes em vez de montar manualmente |
| Atestados referenciados por nome + file_id | Sim — somatório retorna `drive_file_name` e `drive_file_id` por atestado | Jurídico sabe exatamente qual PDF incluir no envelope |
| Declarações padrão | Geradas automaticamente via templates + `xertica_profile.yaml` | Elimina retrabalho repetido em todo certame; jurídico só revisa e assina |
| Formato de documentos no MVP | `text/plain` no card (botão Copiar) | Zero dependência de Docs API no MVP; migra para Google Docs API na Fase 8 |

---

## 11. O que a Amália precisa fazer manualmente

### Ações GCP

1. Habilitar **Drive API** no projeto (`gcloud services enable drive.googleapis.com`)
2. **Domain-Wide Delegation** para a SA no Workspace Admin
3. Criar pasta `Xertica Licitações/` no Drive e compartilhar com a SA
4. (Fase 7) OAuth 2.0 client para NextAuth — JS origins + redirect URIs

### Conteúdo jurídico

5. **Curar `tcu_sumulas.yaml`** antes da Fase 5 — 8 súmulas via prompt do §6.6 Caminho B
6. **Validar 1–2 minutas** geradas pelo Analista Licitatório com o jurídico antes do rollout

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
| BQ com carga acima do MVP | Baixo no MVP | Trigger em §7: >500 mov/dia → migrar estado para Firestore |
| Pasta Drive cresce e inviabiliza sync | Baixo no MVP | Sync incremental por timestamp. Fallback: GCS espelhado. |

---

## 13. Métricas de sucesso

### Fases 5–6 (MVP)

- Jurídico processa ≥ 5 editais no app em 2 semanas sem pedir para voltar ao Trello
- Minuta de esclarecimento aprovada com ≤ 30% de edição
- Vendedor consulta card antes de enviar proposta em ≥ 80% dos casos

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
| 2026-04-18 | Estratégia de curadoria de súmulas formalizada: Caminho B (YAML + IA) no MVP → Caminho C (Firestore + UI) na Fase 8.5. BQ para kanban: aceitável no MVP com trigger de migração documentado. |
| 2026-04-18 | Analista Licitatório expandido para 6 blocos: Bloco 4 renomeado para `DocumentosProtocolo` com distinção ESCLARECIMENTO/IMPUGNACAO e prazos calculados. Bloco 6 `KitHabilitacao` adicionado com referências nominais do Drive. Novo §6.7 Gerador de Declarações padrão (Grupo A + B). Somador expandido com `drive_file_name`, `drive_file_id` e `kit_minimo_recomendado`. |

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

*Versão: v2.2 · 2026-04-18*
*Canônico a partir desta data — substitui x-biding v0.1 completamente.*
*Conflita com `architecture.md` apenas no nome: lici-adk é o motor; x-lici é o produto.*
