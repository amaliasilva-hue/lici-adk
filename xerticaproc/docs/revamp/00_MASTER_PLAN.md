# xerticaproc — Master Plan de Revamp + Copiloto Conversacional

**Versão:** 1.0 | **Data:** 2026-05-07 | **Owner:** Amália

---

## 1. Tese central

Hoje o xerticaproc executa um **pipeline linear** (DFD → agentes → ETP/TR).
Vamos transformá-lo em um **copiloto consultivo** que:

1. **Conduz** uma conversa estruturada com o servidor público
2. **Captura** fatos, decisões, fontes e pendências de cada turno
3. **Mantém** um checklist vivo da Lei 14.133 + IN 94
4. **Pesquisa** preços com classificação metodológica (direto/indireto/paramétrico/outlier)
5. **Bloqueia** geração de ETP/TR enquanto o processo não está maduro
6. **Gera** documentos defensáveis com rastreabilidade completa

Em paralelo: **revamp visual completo** com design system Xertica (cores `#080F1A` / `#00BCD4` / `#1E5FA8`, glassmorphism, orbs).

---

## 2. Diferença entre estado atual e estado-alvo

| Dimensão | Hoje | Alvo |
|---|---|---|
| **Entrada** | Formulário linear | Chat conversacional + formulário "avançado" opcional |
| **Captura** | Campos do form | Análise estruturada de cada turno (`ConversationTurnAnalysis`) |
| **Estado** | `EvidenceBundle` em memória | Bundle + Checklist vivo + Decision Ledger + Sources Workbench |
| **Preços** | Score 0–1 | Score + tipo (direto/indireto/paramétrico/outlier) + busca negativa |
| **Geração** | Quando usuário pede | Bloqueada por `ReadinessAgent` até maturidade mínima |
| **Visual** | Tailwind v4 quebrado, telas inconsistentes | Design system Xertica + glassmorphism + UX premium |
| **UX** | Wizard linear de 7 etapas | Workspace híbrido: chat + checklist + price-board + decisões |

---

## 3. Mudança arquitetural (resumo)

```
ANTES (pipeline linear):
  EntradaDemanda → [Demanda → Decomposição → Mercado → Preços → Técnico → Jurídico → Riscos] → Redator → Revisor → ETP/TR

DEPOIS (copiloto conduzido):
  Conversation Orchestrator                 ← turno do usuário
       │
       ├─ extrai fatos        → facts table
       ├─ registra decisões   → decisoes_conversa
       ├─ atualiza checklist  → checklist_itens
       ├─ valida fontes       → fontes_usuario / pesquisas_negativas
       ├─ chama agentes sob demanda como TOOLS:
       │    ├─ DemandaAgent (estrutura necessidade)
       │    ├─ PrecosAgent (normaliza fonte/preço)
       │    ├─ JuridicoAgent (valida decisão)
       │    ├─ TecnicoAgent (avalia requisito)
       │    └─ ChecklistAgent (auditoria do estado)
       └─ devolve resposta + sugestão da próxima pergunta

  ReadinessAgent ← solicitação "Gerar ETP/TR"
       │
       ├─ valida bloqueantes
       ├─ retorna `can_generate=true/false` + lista de pendências
       └─ se aprovado, chama Redator → Revisor → DocumentoGerado
```

Os agentes existentes **não morrem**. Eles viram **ferramentas** (FunctionTools) do Conversation Orchestrator, acionados quando relevantes.

---

## 4. Documentos deste plano

| # | Documento | Conteúdo |
|---|---|---|
| 00 | [Master Plan](./00_MASTER_PLAN.md) | Este documento |
| 01 | [Design System](./01_DESIGN_SYSTEM.md) | Tokens, tipografia, componentes, decisão Tailwind v4 |
| 02 | [Copilot Architecture](./02_COPILOT_ARCHITECTURE.md) | Conversation Orchestrator + ChecklistAgent + ReadinessAgent |
| 03 | [Data Model v2](./03_DATA_MODEL_V2.md) | Novas tabelas (mensagens, facts, checklist, fontes, etc.) |
| 04 | [API Contract](./04_API_CONTRACT.md) | Endpoints novos `/chat`, `/checklist`, `/decisoes`, `/readiness`, `/gerar` |
| 05 | [Checklist Engine](./05_CHECKLIST_ENGINE.md) | Estrutura do checklist Lei 14.133 + IN 94 + máquina de estados |
| 06 | [Price Workbench](./06_PRICE_WORKBENCH.md) | Direto/indireto/paramétrico/outlier + busca negativa |
| 07 | [UX Screens](./07_UX_SCREENS.md) | Wireframes e fluxos das telas (workspace, chat, price-board, decisões) |
| 08 | [Guardrails v2](./08_GUARDRAILS_V2.md) | G11–G18 (paramétrico, busca negativa, exclusões, etc.) |
| 09 | [Roadmap & Sprints](./09_ROADMAP_SPRINTS.md) | Sprints A/B/C/D + critérios de aceite + deploy plan |
| 10 | [Prompts](./10_PROMPTS.md) | System prompts do Copiloto, Checklist, Readiness |

---

## 5. Estratégia de execução (alto nível)

### Fase 1 — Fundação (Sprint A)
- Design system implementado e aprovado
- Schema v2 no AlloyDB (migrations)
- Endpoint `/chat` + tabelas `mensagens`, `facts`, `decisoes_conversa`
- ChatWorkspace básico funcional (stream + sidebar checklist)

### Fase 2 — Captura estruturada (Sprint B)
- ChecklistAgent + Checklist vivo na UI
- Decision Ledger funcional
- Source Workbench (usuário cola URL/texto, sistema valida e classifica)
- Busca negativa registrada como evidência

### Fase 3 — Maturidade & geração (Sprint C)
- ReadinessAgent + endpoint `/readiness`
- Botões "Gerar ETP" / "Gerar TR" condicionais
- Redator usa apenas EvidenceBundle (sem invenção)
- Lista de "campos abertos para órgão" antes da geração

### Fase 4 — Auditoria e exportação (Sprint D)
- Revisor com cross-check ETP↔TR↔Bundle
- Pacote de evidências exportável (DOCX/PDF/XLSX)
- Dashboards BigQuery (latência por agente, taxa de geração bloqueada, fontes descartadas)
- Smoke E2E + carga

Cada sprint tem **deploy próprio** em Cloud Run e teste E2E manual antes de fechar.

---

## 6. Princípios de design (não negociáveis)

1. **Brandbook é lei.** Cores, tipografia e tokens vêm de `brandbookstyle.css` (Xertica). Sem invenção visual.
2. **Conduzir > responder.** Cada turno do copiloto deve mover a conversa para mais perto da geração (uma pergunta de cada vez, a mais importante).
3. **Inferência ≠ confirmação.** Tudo que o sistema deduz vai marcado como `inferido`. Só vira `confirmado` com aceite explícito do usuário.
4. **Não inventar fonte.** Sem fonte rastreável → `pendente`. Nunca preço sem memória.
5. **Bloqueio amigável.** Quando faltar dado bloqueante para gerar ETP/TR, o sistema explica o que falta e oferece o caminho mais curto.
6. **Auditoria total.** Toda execução de agente, todo turno, toda decisão é registrada com `versao_prompt`, `modelo`, `entrada_hash`, `fontes_usadas`.
7. **PT-BR em toda UI.** Sem anglicismos desnecessários (já está na convenção do repo).
8. **Compatibilidade.** Pipeline antigo (`POST /pipeline`) continua existindo como modo "avançado/headless".

---

## 7. Critérios de aceite globais (DoD do projeto)

O projeto está pronto quando:

- [ ] Usuário consegue gerar um ETP completo a partir **apenas de uma conversa em chat** (sem preencher form)
- [ ] Sistema **bloqueia geração** quando faltar item bloqueante e explica o que falta
- [ ] Toda decisão registrada aparece no painel "Decisões" com justificativa e evidência
- [ ] Toda fonte de preço aparece no Mapa de Preços com classificação (direto/indireto/paramétrico/outlier/descartada)
- [ ] Busca negativa é registrada e citada no documento como "fonte não localizada"
- [ ] Visual está consistente com brandbook em todas as telas (auditoria visual lado-a-lado com mocks)
- [ ] Revisor detecta inconsistências ETP↔TR↔Bundle
- [ ] Pacote de evidências exportável em DOCX + PDF + XLSX
- [ ] Smoke E2E roda em produção sem erro
- [ ] `cloudbuild.yaml` faz deploy automático no push para `main`

---

## 8. Riscos identificados e mitigação

| Risco | Mitigação |
|---|---|
| Tailwind v4 não está aplicando classes em produção | Decisão arquitetural no doc 01 (manter ou migrar para CSS modules) **antes** de codar |
| Conversa muito longa estoura contexto Gemini | Compactação de histórico via `Summarizer` a cada N turnos; bundle estruturado é a memória "permanente" |
| Usuário trouxer fonte ruim/marketplace | Validação no `PriceWorkbench` + guardrails G3/G6/G11 |
| Custo Gemini Pro alto por turno | Classificação inicial de turno feita por Flash; Pro só para análise profunda quando necessário |
| Migração de schema quebrar dados existentes | Schema v2 é aditivo (novas tabelas, não altera as existentes); migration `002_copilot_schema.sql` |
| ReadinessAgent pode ser permissivo demais | Threshold por categoria + lista de itens bloqueantes hardcoded da Lei 14.133 (doc 05) |

---

## 9. O que NÃO está no escopo (out of scope)

- Integração com SEI (fica para sprint futuro)
- Vertex AI Vector Search (pgvector é suficiente para MVP)
- Multi-tenancy (apenas Xertica/operaciones-br por enquanto)
- Aprovação digital com certificado ICP-Brasil (apenas registro de aprovação humana)
- Mobile app (responsivo web é suficiente)

---

## 10. Próximos passos imediatos

1. ✅ Criar este conjunto de documentos
2. 🔄 Revisar com a Amália — aprovação ou ajuste
3. ⏳ Iniciar Sprint A (design system + schema v2 + /chat básico)
4. ⏳ Deploy Sprint A em produção e teste E2E
5. ⏳ Iterar Sprints B/C/D
