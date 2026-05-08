# 09 — Roadmap e Sprints

Cada sprint = 1 semana focada. DoD ao final de cada sprint inclui: deploy em Cloud Run, smoke test verde, doc atualizada.

---

## Sprint A — Visual + Conversa mínima

**Meta:** Workspace híbrido funcionando com chat real e checklist vivo.

### Backend
- [ ] Migration `002_copilot_schema.sql` aplicada (doc 03)
- [ ] `agents/conversation_orchestrator.py` com `handle_turn()` + schema `ConversationTurnAnalysis`
- [ ] `agents/checklist_engine.py` com seed e CRUD
- [ ] Endpoints `/proc/contratacoes/{id}/chat` (SSE), `/chat/history`, `/checklist`, `/checklist/{key}` (PATCH)
- [ ] Compactação de contexto a cada 16 turnos (resumo no campo `conversas.resumo`)
- [ ] Logs estruturados de turno em BigQuery `eventos_conversa`

### Frontend
- [ ] Migrar Tailwind v4 → v3.4 em `xerticaproc/web` (doc 01)
- [ ] Tokens CSS + `tailwind.config.ts` aplicados
- [ ] Componentes base: Button, Card, Badge, ChecklistItem, ChatBubble, AppShell
- [ ] Tela `/contratacoes/[id]` (workspace 3 colunas, doc 07)
- [ ] Hook `useChatStream` consumindo SSE
- [ ] Hook `useChecklist` com revalidate em `checklist_updated`

### DoD Sprint A
- Usuário cria contratação, troca 5+ mensagens, vê fatos extraídos virarem itens do checklist em tempo real
- Visual com brand Xertica aplicado (cyan + blue + glass)
- Lighthouse perf ≥ 80 em `/contratacoes/[id]`

---

## Sprint B — Price Workbench + fontes do usuário

**Meta:** Usuário traz link/texto/arquivo e vê fonte normalizada e classificada.

### Backend
- [ ] `tools/price_workbench.py` com `validate(source_id)` (doc 06)
- [ ] Pipeline de URL: fetch + allow-list domínios + extração Gemini Flash
- [ ] Pipeline de texto colado: extração Gemini Flash com schema
- [ ] Pipeline de arquivo: signed URL + Document AI + Gemini Flash
- [ ] Endpoint `POST /proc/contratacoes/{id}/fontes` (async, retorna 202)
- [ ] Endpoint `GET /fontes`, `PATCH /fontes/{id}`, `POST /pesquisas-negativas`
- [ ] Guardrails G3, G6, G11, G13, G14, G15 aplicados na validação
- [ ] `agents/precos_agent.py` registra automaticamente busca negativa quando PNCP/Compras retornam 0
- [ ] Geração automática de "memória de cálculo" textual por item

### Frontend
- [ ] Modal "Adicionar fonte" no painel direito do workspace (4 abas)
- [ ] Tela `/contratacoes/[id]/precos` (doc 07) com tabs por classificação
- [ ] Card de fonte com ações reclassificar/descartar
- [ ] Bloco "Memória de cálculo" renderizado
- [ ] Toast quando fonte é validada via SSE `price_sources_added`

### DoD Sprint B
- Usuário cola URL PNCP → fonte aparece validada em ≤ 30s, com classificação
- Cada item de quantidade tem memória de cálculo gerada
- Buscas negativas registradas e visíveis na UI
- Mapa exporta XLSX com aba "Memória"

---

## Sprint C — Readiness + geração de ETP

**Meta:** Sistema sabe quando pode gerar e gera ETP completo com placeholders para o órgão.

### Backend
- [ ] `agents/readiness_agent.py` com schema `DocumentReadiness` (doc 02 §4)
- [ ] Endpoint `GET /proc/contratacoes/{id}/readiness?doc_type=etp`
- [ ] `agents/redator_agent.py` adaptado: lê `facts` + `decisoes_conversa` + `checklist_itens` + `itens_mercado`
- [ ] Renderer com placeholders `[CAMPO PENDENTE — ...]` para itens de owner=`orgao` (G16)
- [ ] Endpoint `POST /proc/contratacoes/{id}/gerar/etp` (async, valida readiness antes)
- [ ] Snapshot em `readiness_snapshots` a cada tentativa de geração
- [ ] `documentos_gerados` populado com versionamento (v1, v2, v3...)

### Frontend
- [ ] Indicador de readiness no TopBar do workspace (% + tooltip com bloqueantes)
- [ ] Comando `/gerar etp` no chat → executa `/readiness` → mostra modal com bloqueantes ou confirma
- [ ] Tela `/contratacoes/[id]/etp` (doc 07) com split documento + chat lateral
- [ ] Aprovação humana: botão `[Aprovar]` registra em `aprovacoes`
- [ ] Histórico de revisões na sidebar direita

### DoD Sprint C
- Contratação com checklist completo gera ETP em < 60s
- ETP sai com placeholders nos campos `gestao.*` (não inventados)
- Tentar gerar com bloqueante pendente retorna 422 com payload de readiness e UI mostra o que falta
- Usuário aprova ETP → status muda para `aprovado_internamente`

---

## Sprint D — TR, Mapa, Riscos, Pacote de evidências

**Meta:** Suite completa de documentos + exportações + revisor automático.

### Backend
- [ ] `agents/tr_agent.py` (gera TR a partir de ETP aprovado, exige `tec.modelo_suporte`)
- [ ] `agents/mapa_precos_agent.py` (gera mapa estruturado em XLSX)
- [ ] `agents/revisor_agent.py` (review automático: aderência 14.133, IN 94, contradições)
- [ ] Endpoint `POST /proc/contratacoes/{id}/gerar/tr`, `/gerar/mapa-precos`
- [ ] Endpoint `GET /proc/contratacoes/{id}/pacote-evidencias?format=zip`
- [ ] Cloud Run Job `xerticaproc-export` para conversão MD → DOCX/PDF (Pandoc)
- [ ] BigQuery views: `funil_contratacoes`, `tempo_medio_ciclo`, `taxa_aprovacao_primeira`

### Frontend
- [ ] Tela `/contratacoes/[id]/tr`
- [ ] Tela `/contratacoes/[id]/mapa-precos`
- [ ] Tela `/contratacoes/[id]/evidencias` com botão de download .zip
- [ ] Dashboard `/dashboard` com cards + funil + recentes (doc 07)
- [ ] Tela `/admin/templates` para curadoria
- [ ] Tela `/contratacoes/[id]/historico` (timeline imutável)
- [ ] Notificações via SSE/poll: bell na TopBar

### DoD Sprint D
- Fluxo end-to-end: nova contratação → chat → fontes → ETP → TR → Mapa → pacote .zip
- Tempo médio para uma contratação completa (caso DESO) < 4h de trabalho humano (de 2 semanas)
- Revisor identifica e sinaliza ≥ 90% de contradições conhecidas (banco de testes)
- Lighthouse ≥ 90 em todas as telas

---

## Pós-D (backlog)

- E1: integração WhatsApp/Slack do chat (mesmo backend)
- E2: workflow de aprovação multi-nível (assinatura digital ICP)
- E3: integração SEI/SUAP (push do ETP/TR direto no processo)
- E4: vector search no histórico (`embeddings` em mensagens) para "já fizemos algo parecido?"
- E5: knowledge agent que consulta jurisprudência TCU em tempo real

---

## Métricas de sucesso (medidas em BigQuery)

| Métrica | Meta sprint D | Atual |
|---|---|---|
| Tempo médio captação → ETP pronto | ≤ 24h | 14 dias |
| Taxa de retrabalho (revisor) | ≤ 15% | n/d |
| Cobertura de busca negativa registrada | 100% | 0% |
| Memória de cálculo presente | 100% | parcial |
| Decisões com fonte rastreável | 100% | n/d |

---

## Dependências externas

- Vertex AI Gemini 2.5 Pro/Flash em `us-central1` (já habilitado)
- Document AI Form Parser US (a habilitar)
- Cloud Storage bucket `xerticaproc-uploads` (a criar via Terraform)
- Service account `xerticaproc-sa@operaciones-br.iam` com roles `aiplatform.user`, `documentai.apiUser`, `storage.objectAdmin`, `cloudsql.client`
