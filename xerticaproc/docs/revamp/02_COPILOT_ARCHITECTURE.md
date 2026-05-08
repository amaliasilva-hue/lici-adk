# 02 — Copilot Architecture

---

## 1. Visão arquitetural

```
                       ┌──────────────────────┐
   usuário fala  ────▶ │  POST /chat (turno)  │
                       └──────────┬───────────┘
                                  ▼
                ┌────────────────────────────────────┐
                │  Conversation Orchestrator          │
                │  (LlmAgent — Gemini 2.5 Flash)      │
                │                                     │
                │  Saída estruturada:                  │
                │  ConversationTurnAnalysis            │
                └──────────┬─────────────────────────┘
                           │
       ┌───────────────────┼─────────────────────────────────┐
       │                   │                                 │
       ▼                   ▼                                 ▼
┌─────────────┐    ┌────────────────┐               ┌─────────────────┐
│ Persistência│    │ Tools (sob     │               │ Resposta para   │
│ (DB writes) │    │ demanda)       │               │ usuário         │
│             │    │                │               │  + sugestão     │
│ - mensagens │    │ - DemandaAgent │               │  - próxima      │
│ - facts     │    │ - PrecosAgent  │               │    pergunta     │
│ - decisoes  │    │ - JuridicoAg.  │               │  - status do    │
│ - checklist │    │ - TecnicoAg.   │               │    checklist    │
│ - fontes    │    │ - ChecklistAg. │               └─────────────────┘
└─────────────┘    │ - ReadinessAg. │
                   │ - WebSearch    │
                   │ - PNCP/Compras │
                   └────────────────┘

quando usuário pede "Gerar ETP":
                       ┌──────────────────────┐
                       │ POST /gerar/etp      │
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐
                       │  ReadinessAgent       │
                       │  (Gemini Flash)       │
                       │  → can_generate?      │
                       └──────┬─────┬──────────┘
                              │ no  │ yes
                              ▼     ▼
                  responde com  ┌─────────────────┐
                  pendências    │  Redator + Revisor│
                                │  (Gemini Pro)    │
                                │  → DocumentoGerado│
                                └─────────────────┘
```

---

## 2. Conversation Orchestrator

**Arquivo:** `xerticaproc/backend/agents/conversation_orchestrator.py`

### Contrato de saída

```python
from typing import Literal
from pydantic import BaseModel
from uuid import UUID

class Fact(BaseModel):
    tipo: str                       # 'modalidade', 'prazo_meses', 'lote', 'restricao'...
    valor: dict                     # JSON com o conteúdo estruturado
    confianca: float                # 0–1; <0.7 marca como inferido
    fonte_mensagem_id: UUID | None  # mensagem que originou o fato

class Decision(BaseModel):
    tipo: str                       # 'modelo_contratacao', 'lote_unico', 'exclusao_produto'...
    valor: dict
    justificativa: str
    fonte: Literal['usuario', 'sistema', 'documento', 'pesquisa']

class ChecklistUpdate(BaseModel):
    item_id: str                    # id do checklist (ver doc 05)
    status: Literal['pendente', 'inferido', 'confirmado', 'dispensado']
    valor: str | None
    evidence_ids: list[UUID] = []

class PriceSourceCandidate(BaseModel):
    tipo: Literal['url', 'texto_colado', 'arquivo', 'print']
    url: str | None
    raw_text: str | None
    produto: str | None
    valor_total: float | None
    quantidade: float | None
    vigencia_meses: int | None

class CalculationRequest(BaseModel):
    operacao: Literal['normalizar_preco', 'media_ponderada', 'matriz_quantitativos']
    parametros: dict

class ConversationTurnAnalysis(BaseModel):
    intent: Literal[
        'informacao_nova',
        'decisao',
        'duvida_tecnica',
        'fornecer_fonte_preco',
        'ajuste_escopo',
        'pedir_geracao',
        'pedir_revisao',
        'cumprimento',
        'fora_escopo',
    ]
    facts_to_add: list[Fact] = []
    decisions_to_add: list[Decision] = []
    checklist_updates: list[ChecklistUpdate] = []
    price_sources_to_add: list[PriceSourceCandidate] = []
    calculations_to_run: list[CalculationRequest] = []
    user_response: str              # resposta natural para o chat
    next_best_question: str | None  # próxima pergunta sugerida (a mais importante)
    suggested_action: Literal[
        'continuar_conversa',
        'validar_fonte',
        'rodar_calculo',
        'consultar_juridico',
        'pedir_confirmacao',
        'oferecer_geracao',
        'bloquear_geracao',
    ]
```

### Fluxo de processamento de um turno

```python
async def handle_turn(contratacao_id: UUID, user_message: str) -> TurnResponse:
    # 1. Persistir mensagem do usuário
    msg_user = await save_message(contratacao_id, role='user', content=user_message)

    # 2. Carregar contexto compactado
    context = await build_context(contratacao_id)
    # = últimas 8 mensagens + checklist atual + decisões + fontes ativas + bundle resumido

    # 3. Chamar Conversation Orchestrator (LlmAgent com response_schema)
    analysis: ConversationTurnAnalysis = await orchestrator.analyze(
        context=context,
        user_message=user_message,
    )

    # 4. Persistir extração estruturada
    await persist_facts(contratacao_id, analysis.facts_to_add, msg_user.id)
    await persist_decisions(contratacao_id, analysis.decisions_to_add)
    await apply_checklist_updates(contratacao_id, analysis.checklist_updates)

    # 5. Acionar tools sob demanda
    if analysis.price_sources_to_add:
        for src in analysis.price_sources_to_add:
            await price_workbench.ingest(contratacao_id, src)  # async, registra em fontes_usuario

    if analysis.calculations_to_run:
        for calc in analysis.calculations_to_run:
            await calculation_engine.run(contratacao_id, calc)

    if analysis.intent == 'pedir_geracao':
        readiness = await readiness_agent.evaluate(contratacao_id, doc_type='etp')
        # readiness vira parte da resposta

    # 6. Persistir resposta do assistant
    msg_assistant = await save_message(
        contratacao_id, role='assistant',
        content=analysis.user_response,
        meta={'next_best_question': analysis.next_best_question,
              'suggested_action': analysis.suggested_action},
    )

    # 7. Retornar payload completo para o frontend
    return TurnResponse(
        assistant_message=analysis.user_response,
        facts_added=analysis.facts_to_add,
        decisions_added=analysis.decisions_to_add,
        checklist_updates=analysis.checklist_updates,
        price_sources_added=[...],
        readiness=readiness if 'readiness' in locals() else None,
        next_best_question=analysis.next_best_question,
        suggested_action=analysis.suggested_action,
    )
```

### Modelo

- **Modelo padrão:** `gemini-2.5-flash` (baixa latência, custo controlado)
- **Temperatura:** 0.3 (algum espaço criativo na resposta natural, mas extração determinística)
- **`response_schema`:** `ConversationTurnAnalysis` (forçar JSON estruturado)
- **System prompt:** ver [10_PROMPTS.md](./10_PROMPTS.md)

### Compactação de contexto

A cada turno, o contexto enviado ao modelo é:

```
[SYSTEM PROMPT — fixo, ver doc 10]

[ESTADO ATUAL da contratação — JSON compactado]
{
  "objeto": "...",
  "checklist_resumo": {"confirmado": 12, "inferido": 3, "pendente": 8, "bloqueante_pendente": 2},
  "decisoes_principais": [...top 5 mais recentes],
  "fontes_validas": N,
  "fontes_descartadas": M,
  "readiness": {"can_etp": false, "missing": ["dotacao", "gestor"]}
}

[ÚLTIMAS 8 MENSAGENS da conversa]

[NOVA MENSAGEM DO USUÁRIO]
```

Quando passar de 16 mensagens, um `Summarizer` (chamada extra) condensa as 8 mais antigas em "resumo histórico".

---

## 3. ChecklistAgent

**Arquivo:** `xerticaproc/backend/agents/checklist_agent.py`

**Função:** auditar o estado do checklist a cada turno e inferir mudanças que o Orchestrator pode ter perdido.

**Quando rodar:** após cada turno do Orchestrator, **se** `intent in {informacao_nova, decisao, ajuste_escopo}`.

**Saída:** `list[ChecklistUpdate]` adicional, mesclado ao que o Orchestrator já produziu.

**Modelo:** `gemini-2.5-flash` (rápido, determinístico).

```python
async def audit(contratacao_id: UUID, recent_turn: dict) -> list[ChecklistUpdate]:
    """Recebe o estado + último turno, retorna inferências adicionais para o checklist."""
```

Ver itens do checklist no doc [05_CHECKLIST_ENGINE.md](./05_CHECKLIST_ENGINE.md).

---

## 4. ReadinessAgent

**Arquivo:** `xerticaproc/backend/agents/readiness_agent.py`

### Saída

```python
class DocumentReadiness(BaseModel):
    doc_type: Literal['etp', 'tr', 'mapa_precos']
    can_generate: bool
    score: float                              # 0–1 (% de itens não-bloqueantes preenchidos)
    blocking_missing: list[ChecklistItemRef]  # bloqueantes pendentes
    optional_missing: list[ChecklistItemRef]  # não-bloqueantes pendentes
    inferred_items: list[ChecklistItemRef]    # itens marcados como inferidos (alerta)
    open_fields_for_orgao: list[str]          # campos institucionais que o órgão preenche manualmente
    recommendations: list[str]                # texto natural com próximos passos
```

### Lógica

```python
async def evaluate(contratacao_id: UUID, doc_type: str) -> DocumentReadiness:
    checklist = await load_checklist(contratacao_id)
    bundle = await load_bundle(contratacao_id)

    # Itens bloqueantes são definidos por doc_type (ver doc 05)
    required_blocking = REQUIRED_BLOCKING_ITEMS[doc_type]

    blocking_missing = [it for it in required_blocking
                        if checklist[it].status not in ('confirmado', 'inferido', 'dispensado')]

    can_generate = len(blocking_missing) == 0

    # Score = (confirmados + 0.6*inferidos + dispensados) / total não-bloqueantes
    ...

    # open_fields_for_orgao: campos que sempre ficam em branco para o órgão preencher
    open_fields = checklist.filter(owner='orgao', status='pendente')

    # recomendações: chamar Gemini Flash para texto natural com próximos passos
    recs = await llm_recommendations(blocking_missing, optional_missing)

    return DocumentReadiness(...)
```

**Threshold:** `can_generate` exige **0 bloqueantes pendentes**. Itens não-bloqueantes podem ficar abertos (devem aparecer no doc como "a definir pelo órgão").

---

## 5. Os agentes existentes viram tools

Os 9 agentes atuais (`demanda`, `decomposicao`, `mercado`, `precos`, `tecnico`, `juridico`, `riscos`, `redator`, `revisor`) **continuam existindo** mas mudam de papel:

| Agente | Papel novo |
|---|---|
| `demanda_agent` | Tool: estrutura `EntradaDemanda` quando usuário trouxe DFD anexo |
| `decomposicao_agent` | Tool: decompõe objeto quando bundle tem demanda mas não tem itens |
| `mercado_agent` | Tool: gera matriz de alternativas quando solicitado pelo usuário |
| `precos_agent` | Tool: pipeline de preços com PNCP/Compras quando usuário não trouxe fontes próprias |
| `tecnico_agent` | Tool: gera requisitos técnicos quando há checklist técnico pendente |
| `juridico_agent` | Tool: valida conformidade quando usuário decide algo com implicação legal |
| `riscos_agent` | Tool: gera matriz de riscos antes da geração de TR |
| `redator_agent` | Tool: gera ETP/TR (só após `ReadinessAgent` aprovar) |
| `revisor_agent` | Tool: cross-check ETP↔TR↔Bundle no final |

O Conversation Orchestrator decide **quando** chamar cada um, baseado em `suggested_action` e estado do checklist.

### Pipeline antigo: compatibilidade

`POST /proc/contratacoes/{id}/pipeline` continua funcionando como modo **headless** — útil para batch ou para usuário que quer pular a conversa e enviar tudo via JSON.

---

## 6. ADK SequentialAgent vs nova orquestração

### Decisão

O **Conversation Orchestrator é um `LlmAgent`** (não `SequentialAgent`), porque:
- Conversa é não-determinística — não sabemos qual tool chamar antes de processar o turno
- Cada turno pode chamar 0, 1 ou N tools dependendo do conteúdo
- Mais natural usar `tools=[...]` do ADK e deixar o modelo decidir

### Estrutura ADK

```python
from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool

conversation_orchestrator = LlmAgent(
    name='conversation_orchestrator',
    model='gemini-2.5-flash',
    instruction=SYSTEM_PROMPT_CONVERSATION,
    output_schema=ConversationTurnAnalysis,
    tools=[
        FunctionTool(price_workbench.validate_source),
        FunctionTool(checklist_engine.update_item),
        FunctionTool(decision_ledger.record),
        FunctionTool(demanda_agent.run),
        FunctionTool(precos_agent.run),
        FunctionTool(juridico_agent.run),
        # ...
    ],
)
```

O `output_schema` força o modelo a retornar JSON conformante — isso é o que dá previsibilidade ao sistema.

---

## 7. Memória estruturada (não só histórico de chat)

A memória do copiloto **não é** o histórico de mensagens. É:

| Camada | Onde mora | TTL | Uso |
|---|---|---|---|
| **Histórico literal** | `mensagens` (DB) | permanente | display + auditoria |
| **Janela conversacional** | últimos 8 turnos | sliding | enviado ao Gemini a cada turno |
| **Resumo histórico** | `conversas.resumo` | atualizado a cada 16 turnos | substitui janela antiga |
| **Estado estruturado** | checklist + decisoes + facts + fontes | permanente | **fonte da verdade** para o copiloto |
| **EvidenceBundle** | `evidence_bundles` | snapshot por etapa | input do Redator |

> **A "memória" real do copiloto é o estado estruturado, não as mensagens.**
> As mensagens existem para o usuário (display + auditoria); o LLM trabalha em cima do estado JSON.

---

## 8. Streaming de resposta

O endpoint `POST /chat` retorna **SSE** (Server-Sent Events):

```
event: assistant_token
data: "Entendi"

event: assistant_token
data: ", você quer"

event: assistant_token
data: " modelo de Registro de Preços."

event: facts_added
data: [{"tipo":"modelo_contratacao","valor":{"sistema":"registro_de_precos"}}]

event: checklist_updated
data: [{"item_id":"escopo.modalidade","status":"confirmado"}]

event: turn_complete
data: {"next_best_question":"Qual o prazo referencial em meses?", "suggested_action":"continuar_conversa"}
```

O frontend renderiza incrementalmente: tokens no chat, badges aparecem na sidebar conforme `facts_added` / `checklist_updated` chegam.

---

## 9. Compactação e custo

| Componente | Modelo | Tokens médios entrada | Tokens médios saída | Custo turno |
|---|---|---|---|---|
| Conversation Orchestrator | Flash | 2.000–4.000 | 400–800 | ~$0.001 |
| ChecklistAgent | Flash | 1.500 | 200 | ~$0.0005 |
| Tool: PrecosAgent (quando chamado) | Flash | 3.000 | 600 | ~$0.0015 |
| Tool: JuridicoAgent (RAG) | Pro | 6.000 | 800 | ~$0.012 |
| ReadinessAgent (1× por geração) | Flash | 2.500 | 400 | ~$0.001 |
| Redator (1× por geração) | Pro | 12.000 | 4.000 | ~$0.06 |
| Revisor (1× por geração) | Pro | 15.000 | 1.500 | ~$0.05 |

**Estimativa:** uma contratação completa (30 turnos + 1 ETP + 1 TR + revisões) ≈ **$0.30 em IA**.

---

## 10. Critérios de aceite (DoD do Copilot)

- [ ] `ConversationTurnAnalysis` valida 100% dos turnos no teste E2E (sem `ValidationError`)
- [ ] Cada turno produz pelo menos 1 entrada em `facts` ou `checklist_itens` ou `decisoes_conversa`
- [ ] `next_best_question` é não-nulo em ≥ 80% dos turnos antes de readiness
- [ ] `ReadinessAgent` bloqueia geração quando faltar item bloqueante (teste com checklist vazio)
- [ ] Stream SSE entrega `turn_complete` em ≤ 8s p95
- [ ] Compactação de contexto mantém prompt total ≤ 8.000 tokens (limite suave)
- [ ] Logs em `prompt_execucoes` para todo turno e toda chamada de tool
