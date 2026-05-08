# 05 — Checklist Engine (Lei 14.133 + IN 94)

## Estrutura

Cada contratação recebe um seed de ~32 itens organizados em 9 categorias. `item_key` é estável e referenciado por código.

## Estados

| status | significado |
|---|---|
| `pendente` | nunca preenchido |
| `inferido` | sistema deduziu, falta confirmação humana |
| `confirmado` | usuário ou órgão confirmou explicitamente |
| `dispensado` | não se aplica a esta contratação (justificativa obrigatória) |

## Criticidade

| nível | comportamento |
|---|---|
| `bloqueante` | impede geração de ETP/TR enquanto não estiver confirmado/inferido/dispensado |
| `alto` | recomendado; aparece em "alertas" do readiness |
| `medio` | recomendado; lista normal |
| `baixo` | opcional |

## Owner (quem preenche)

`usuario` (servidor responsável) · `orgao` (campos institucionais — dotação, gestor, processo) · `sistema` (inferido por IA/pesquisa) · `juridico` (revisão jurídica obrigatória)

---

## Catálogo de itens (seed)

### Categoria `demanda`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `demanda.problema_publico` | Problema público que motiva a contratação | bloqueante | usuario |
| `demanda.objetivo` | Objetivo específico e mensurável | bloqueante | usuario |
| `demanda.unidade_demandante` | Unidade demandante | bloqueante | usuario |
| `demanda.alinhamento_pca` | Alinhamento com PCA/PDTIC | alto | usuario |

### Categoria `escopo`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `escopo.objeto_resumido` | Descrição resumida do objeto | bloqueante | usuario |
| `escopo.modalidade` | Modalidade (pregão / dispensa / inexigibilidade) | bloqueante | usuario |
| `escopo.sistema_contratacao` | Registro de Preços ou compra direta | bloqueante | usuario |
| `escopo.lote` | Lote único ou múltiplos lotes (com justificativa) | bloqueante | usuario |
| `escopo.prazo_meses` | Prazo referencial em meses | bloqueante | usuario |
| `escopo.exclusoes` | Itens explicitamente excluídos do escopo | medio | usuario |

### Categoria `quantitativos`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `qtd.matriz_quantitativos` | Matriz de quantidades por item | bloqueante | usuario |
| `qtd.justificativa_dimensionamento` | Justificativa do dimensionamento | alto | usuario |

### Categoria `precos`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `precos.fontes_diretas` | Pelo menos 1 fonte direta por item | bloqueante | sistema |
| `precos.memoria_calculo` | Memória de cálculo do preço de referência | bloqueante | sistema |
| `precos.busca_negativa_registrada` | Busca negativa registrada quando aplicável | alto | sistema |
| `precos.outliers_tratados` | Outliers identificados e tratados | medio | sistema |

### Categoria `tecnico`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `tec.requisitos_funcionais` | Requisitos funcionais | bloqueante | usuario |
| `tec.requisitos_nao_funcionais` | Requisitos não funcionais (SLA, disponibilidade) | alto | usuario |
| `tec.requisitos_seguranca` | Requisitos de segurança | alto | usuario |
| `tec.modelo_suporte` | Modelo de suporte (mensal / sob demanda) | medio | usuario |

### Categoria `juridico`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `jur.aderencia_14133` | Aderência à Lei 14.133/2021 | bloqueante | juridico |
| `jur.aderencia_in94` | Aderência à IN SGD/ME 94/2022 | bloqueante | juridico |
| `jur.justificativa_marca` | Justificativa de marca (se houver) | alto | juridico |
| `jur.exclusividade_fundamento` | Fundamento de exclusividade (se inexigibilidade) | bloqueante | juridico |

### Categoria `lgpd`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `lgpd.tratamento_dados` | Tratamento de dados pessoais identificado | alto | juridico |
| `lgpd.base_legal` | Base legal LGPD identificada | alto | juridico |

### Categoria `gestao`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `gestao.processo` | Número do processo administrativo | bloqueante | orgao |
| `gestao.dotacao_orcamentaria` | Dotação orçamentária | bloqueante | orgao |
| `gestao.gestor_contrato` | Gestor do contrato indicado | bloqueante | orgao |
| `gestao.fiscal_contrato` | Fiscal do contrato indicado | bloqueante | orgao |
| `gestao.autoridade_competente` | Autoridade competente para aprovação | bloqueante | orgao |

### Categoria `documentos`
| item_key | label | criticidade | owner |
|---|---|---|---|
| `doc.dfd_anexado` | DFD anexado ao processo | medio | usuario |
| `doc.matriz_riscos` | Matriz de riscos elaborada | bloqueante | sistema |
| `doc.matriz_alternativas` | Matriz de alternativas elaborada | bloqueante | sistema |

---

## Regras por documento

### Para gerar ETP
Bloqueantes obrigatórios: todos de `demanda` + `escopo` + `quantitativos` + `precos` + `tecnico` + `juridico` + `doc.matriz_alternativas` + `doc.matriz_riscos`.

Itens `gestao.*` ficam **abertos para o órgão** preencher manualmente — listados como "campos em aberto" no documento.

### Para gerar TR
Tudo de ETP + `tec.modelo_suporte` confirmado + ETP já gerado e aprovado.

### Para gerar Mapa de Preços
Bloqueantes: `precos.fontes_diretas` + `precos.memoria_calculo` + `qtd.matriz_quantitativos`.

---

## Máquina de estados de um item

```
       confirma manual
pendente ─────────────▶ confirmado ◀─┐
   │                                  │ confirma override
   │ inferência IA                    │
   ▼                                  │
inferido ─────────────────────────────┘
   │
   │ "não se aplica"
   ▼
dispensado (com justificativa obrigatória)
```

Transição inversa (`confirmado → pendente`) só via `PATCH` explícito do usuário.

---

## Implementação

`xerticaproc/backend/agents/checklist_engine.py`

```python
CHECKLIST_SEED: list[dict] = [
    {"item_key": "demanda.problema_publico", "categoria": "demanda",
     "label": "Problema público que motiva a contratação",
     "criticidade": "bloqueante", "owner": "usuario"},
    # ... ~32 itens
]

REQUIRED_BLOCKING_FOR = {
    "etp": [it["item_key"] for it in CHECKLIST_SEED
            if it["criticidade"] == "bloqueante" and it["owner"] != "orgao"],
    "tr":  [...],  # tudo de etp + extras
    "mapa_precos": ["precos.fontes_diretas", "precos.memoria_calculo", "qtd.matriz_quantitativos"],
}

OPEN_FOR_ORGAO = [it["item_key"] for it in CHECKLIST_SEED if it["owner"] == "orgao"]

async def seed_checklist(contratacao_id: UUID) -> None:
    """Insere os ~32 itens em 'pendente' ao criar contratação."""

async def update_item(contratacao_id: UUID, item_key: str,
                      status: str, valor: dict | None = None,
                      evidence_ids: list[UUID] = []) -> ChecklistItem:
    ...

async def get_summary(contratacao_id: UUID) -> ChecklistSummary:
    """Retorna agregados por status e por categoria (para sidebar)."""
```

---

## UX do Checklist

- Sidebar fixa à direita do workspace
- Por categoria, com badge de progresso (`5/8` confirmado)
- Cada item: dot colorido (status) + label + valor (se preenchido) + popover de evidência
- Filtro: "só pendentes bloqueantes"
- Ação rápida: marcar como dispensado (modal pede justificativa)

Detalhes visuais em [07_UX_SCREENS.md](./07_UX_SCREENS.md).
