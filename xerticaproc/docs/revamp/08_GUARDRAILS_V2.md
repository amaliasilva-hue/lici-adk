# 08 — Guardrails v2

Os guardrails G1–G10 já estão em [ARCHITECTURE.md §13](../../ARCHITECTURE.md). Esta seção adiciona G11–G18, motivados pelos achados do caso DESO e pela arquitetura conversacional.

| ID | Categoria | Regra | Onde implementa |
|---|---|---|---|
| **G11** | Preços | Preço paramétrico **deve** ser explicitamente rotulado como tal no documento e no Mapa, com fórmula visível. Não pode ser exibido como "fonte direta". | `tools/comparabilidade.py` + template renderer |
| **G12** | Preços | Toda busca em PNCP/Compras que retornar 0 resultados **deve** gerar registro em `pesquisas_negativas` antes de o sistema partir para método paramétrico. | `agents/precos_agent.py::buscar_com_registro_negativo` |
| **G13** | Preços | Preço de referência **nunca** inclui impostos quando a fonte original o exclui; e vice-versa. Regime tributário fica explícito por fonte. | `tools/normalizacao.py` (campo `regime_tributario`) |
| **G14** | Catálogo | Nomenclatura de produto deve ser **remodelada** para o nome canônico do catálogo Xertica (ex: "Gemini Enterprise" → "Gemini Enterprise Plus") antes de exposição no documento. Sem rótulo do fornecedor cru. | `tools/normalizacao.py::canonicalizar_nome_produto` |
| **G15** | Catálogo | Produtos **sem** contratação corporativa registrada não entram no Mapa de Preços nem no ETP. Lista mantida em `xerticaproc/backend/knowledge/produtos_corporativos.yaml`. | `agents/precos_agent.py` (filtro) |
| **G16** | Documento | Geração de ETP/TR **nunca** preenche campos de responsabilidade do órgão (`gestao.*`). Esses campos vão ao documento como `[CAMPO PENDENTE — preencher pelo órgão: dotação orçamentária]`. | `agents/redator_agent.py` + `ReadinessAgent` |
| **G17** | Conversa | Casos de uso **inferidos** pela IA são salvos como `confirmado=False` em `facts` e exibidos no chat com badge "inferido pelo sistema" + chip "Confirmar". | `agents/conversation_orchestrator.py` |
| **G18** | Conversa | Decisão registrada com `fonte='usuario'` tem precedência sobre `fonte='sistema'` em qualquer conflito de mesma `decisoes_conversa.tipo`. Sistema nunca sobrescreve decisão humana. | `tools/decisao_store.py` |

## Operacionalização

Cada guardrail tem:
1. **Função de check** em código (`guardrails/g11_parametrico_rotulado.py`, etc.)
2. **Teste unitário** em `tests/guardrails/`
3. **Log estruturado** com `guardrail_id` no evento → BigQuery `eventos_auditoria`

## Pipeline de aplicação

```
Antes de inserir item em itens_mercado     → G3, G6, G11, G13, G14, G15
Antes de gerar documento                   → G16, G17 (via Readiness)
Antes de persistir decisão                 → G18 (verifica conflito)
Em todo turno do chat                      → G17 (rotular inferências)
Após busca em fonte externa                → G12 (registrar negativa)
```

## Testes obrigatórios

`tests/guardrails/test_g11_g18.py` precisa cobrir:
- G11: gerar ETP com fonte paramétrica → deve aparecer "(método paramétrico)" no texto
- G12: simular PNCP retornando 0 → verificar inserção em `pesquisas_negativas`
- G13: fonte com `tributos_inclusos=True` não soma BDI no cálculo
- G14: input "Gemini Enterprise" → mapeado para "Gemini Enterprise Plus"
- G15: produto fora do YAML → erro `PRODUTO_NAO_CORPORATIVO`
- G16: gerar ETP sem `gestao.dotacao_orcamentaria` → documento contém placeholder, não inventa valor
- G17: fato extraído por IA fica `confirmado=False`
- G18: usuário diz "modalidade pregão" → sistema não consegue mais gravar `dispensa` como decisão sem PATCH explícito
