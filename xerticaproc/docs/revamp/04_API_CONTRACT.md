# 04 — API Contract (endpoints novos)

Prefixo: `/proc`. Auth: Google ID-token via header `Authorization: Bearer <token>` (verificado pelo backend).

## 1. Conversa

### `POST /proc/contratacoes/{id}/chat`
Envia mensagem do usuário. Streaming SSE.

**Request body:**
```json
{ "message": "Vai ser lote único, justificar por integração", "anexos": [] }
```

**SSE eventos:**
| event | data |
|---|---|
| `assistant_token` | `"texto parcial"` |
| `facts_added` | `[{tipo, valor, confianca, confirmado}]` |
| `decisions_added` | `[{tipo, valor, justificativa, fonte}]` |
| `checklist_updated` | `[{item_key, status, valor}]` |
| `price_sources_added` | `[{id, tipo, classificacao, status_validacao}]` |
| `readiness` | `{doc_type, can_generate, blocking_missing, ...}` (apenas se intent='pedir_geracao') |
| `turn_complete` | `{message_id, next_best_question, suggested_action}` |
| `error` | `{code, message}` |

### `GET /proc/contratacoes/{id}/chat/history?limit=50&before=ts`
Histórico paginado (display).

**Response:**
```json
{ "messages": [{id, role, conteudo, meta, criado_em}], "has_more": false }
```

## 2. Checklist

### `GET /proc/contratacoes/{id}/checklist`
**Response:**
```json
{
  "by_category": {
    "escopo": [{item_key, label, status, criticidade, owner, valor, evidence_ids}],
    "precos": [...]
  },
  "summary": {"total": 32, "confirmado": 12, "inferido": 5, "pendente": 13, "dispensado": 2,
              "bloqueante_pendente": 2}
}
```

### `PATCH /proc/contratacoes/{id}/checklist/{item_key}`
Confirmação manual do usuário (override).

**Request body:**
```json
{ "status": "confirmado", "valor": "Registro de Preços", "justificativa": "decisão do órgão" }
```

## 3. Decisões

### `GET /proc/contratacoes/{id}/decisoes`
Lista timeline de decisões.

### `POST /proc/contratacoes/{id}/decisoes`
Registra decisão manual (sem passar pelo chat).

**Body:** `{tipo, valor, justificativa, fonte}`

## 4. Fontes (Price Workbench)

### `POST /proc/contratacoes/{id}/fontes`
Usuário adiciona fonte fora do chat.

**Body:**
```json
{ "tipo": "url", "url": "https://pncp.gov.br/...", "produto": "Gemini Enterprise Plus" }
```

**Response:** `{id, status_validacao: "pendente"}` — async; após validação dispara evento WebSocket `fonte_validada` ou poll via `GET /fontes`.

### `GET /proc/contratacoes/{id}/fontes?status=...&classificacao=...`
Lista fontes com filtro.

### `PATCH /proc/contratacoes/{id}/fontes/{fonte_id}`
Atualiza classificação manual: `{classificacao, status_validacao, observacao}`.

### `POST /proc/contratacoes/{id}/pesquisas-negativas`
Registra busca negativa.

**Body:** `{termo, fontes_consultadas, justificativa, efeito_na_estimativa}`

## 5. Cálculos sob demanda

### `POST /proc/contratacoes/{id}/calcular`
**Body:**
```json
{ "operacao": "normalizar_preco",
  "parametros": {"valor_total": 4925.28, "quantidade": 4, "vigencia_meses": 12} }
```
**Response:** `{resultado: {valor_mensal_por_unidade: 102.61}, memoria: "..."}`

## 6. Readiness e geração

### `GET /proc/contratacoes/{id}/readiness?doc_type=etp`
**Response:** `DocumentReadiness` (ver doc 02 §4).

### `POST /proc/contratacoes/{id}/gerar/etp`
Gera ETP. Bloqueia se readiness.can_generate=false (retorna 422 com payload de readiness).

**Response 202:** `{job_id, status: "running"}` (async).

### `POST /proc/contratacoes/{id}/gerar/tr`
Idem para TR (exige ETP gerado e aprovado).

### `POST /proc/contratacoes/{id}/gerar/mapa-precos`
Idem para mapa de preços.

### `GET /proc/contratacoes/{id}/jobs/{job_id}`
Polling de geração.

**Response:** `{status: "running|done|error", progresso_pct, documento_id?, erro?}`

## 7. Documentos e exportação

### `GET /proc/contratacoes/{id}/documentos`
Lista documentos gerados (ETP, TR, Mapa, Memória, Riscos, Evidências).

### `GET /proc/contratacoes/{id}/documentos/{doc_id}?format=md|html|docx|pdf|xlsx`
Retorna conteúdo no formato pedido (DOCX/PDF/XLSX async via Cloud Run Job → assinado URL Storage).

### `GET /proc/contratacoes/{id}/pacote-evidencias?format=zip`
Pacote completo: documentos + bundle JSON + memória de cálculo + checklist final.

## 8. Compatibilidade (mantém pipeline antigo)

### `POST /proc/contratacoes/{id}/pipeline`
Modo headless — recebe `EntradaDemanda` completa, roda pipeline linear, retorna job_id. Mantido para integração programática.

## 9. Erros padronizados

```json
{ "code": "READINESS_BLOCKED",
  "message": "Não é possível gerar ETP. Faltam itens bloqueantes.",
  "details": { "blocking_missing": [...], "open_fields_for_orgao": [...] } }
```

| HTTP | code |
|---|---|
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN_DOMAIN` (não @xertica.com) |
| 404 | `NOT_FOUND` |
| 409 | `STATE_CONFLICT` (ex: gerar TR antes de ETP) |
| 422 | `READINESS_BLOCKED` / `VALIDATION_ERROR` |
| 429 | `RATE_LIMIT` |
| 502 | `UPSTREAM_ERROR` (PNCP, Compras.gov, Vertex) |
| 504 | `TIMEOUT` |
