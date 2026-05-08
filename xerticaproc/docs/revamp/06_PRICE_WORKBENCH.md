# 06 — Price Workbench (Pesquisa Conversacional)

## Princípio

Hoje o pipeline de preços é **fechado** (PNCP/Compras → score). Vamos torná-lo **aberto**: o usuário pode trazer fontes via chat (link, texto colado, arquivo, print), e o sistema valida, normaliza, classifica e integra ao mapa.

Adicionamos também a **busca negativa** como evidência de primeira classe.

## Classificação metodológica (nova dimensão)

Adicional ao score 0–1 já existente:

| Classificação | Quando usar | Exemplo (caso DESO) |
|---|---|---|
| `direta` | mesmo produto, mesma vigência, fonte oficial | PRODEMGE Gemini Enterprise R$ 174 |
| `indireta` | produto similar, ajuste de escopo necessário | PRODEMGE Gemini Business R$ 116 (para Standard) |
| `parametrica` | preço derivado de fórmula/proporção | Frontline ≈ Business × fator |
| `complementar` | fonte secundária, baixa escala | Tarumã Plus R$ 102,61 |
| `outlier` | fora da faixa, mas registrado para sensibilidade | preço 5x mediana |
| `descartada` | não atende guardrails | marketplace, sem origem |

Implementado como enum `PriceReferenceType` em `backend/models/schemas.py` e gravado em `itens_mercado.classificacao`.

---

## Pipeline de uma fonte trazida pelo usuário

```
Usuário fala/cola URL ou texto
       │
       ▼
Conversation Orchestrator detecta intent='fornecer_fonte_preco'
       │
       ▼
Insere em fontes_usuario (status='pendente')
       │
       ▼ (background task)
PriceWorkbench.validate(source_id):
  1. Se URL: fetch + verificar domínio aceito
  2. Se texto: extrair com Gemini Flash (produto, valor, qtd, vigência)
  3. Se arquivo PDF: Document AI + Gemini Flash
  4. Calcular hash de deduplicação
  5. Aplicar guardrails (G3, G6, G11, G13...)
       │
       ├─ falhou guardrail → status='descartada' + observacao
       └─ ok → normaliza → cria item_mercado → calcula score → classifica → status='validada'
       │
       ▼
SSE event para o frontend: fonte_validada
       │
       ▼
Sidebar de Price Board atualiza
```

---

## Validação por tipo

### URL
- Domínio em allow-list: `pncp.gov.br`, `compras.gov.br`, `*.gov.br`, `paineldeprecos.planejamento.gov.br`
- Fetch com User-Agent identificado e timeout 30s
- Se HTML, extrai metadados de contrato/ata via Gemini Flash com prompt estruturado
- Se redireciona para login → status='descartada' + observacao='requer autenticação'

### Texto colado
- Gemini Flash extrai `{produto, valor_total, quantidade, vigencia_meses, orgao, data}`
- Confiança < 0.6 → status='pendente' + pede confirmação ao usuário no próximo turno

### Arquivo PDF
- Upload via signed URL para Cloud Storage `gs://xerticaproc-uploads/{contratacao_id}/{uuid}.pdf`
- Document AI Form Parser → texto + tabelas
- Gemini Flash estrutura igual ao texto colado

### Print (imagem)
- Upload Cloud Storage
- Document AI OCR → texto
- Mesmo pipeline do texto colado
- Marcar `confiabilidade=0.7` por padrão (OCR pode errar)

---

## Normalização (já existente, agora aplicada também a fontes_usuario)

```
valor_mensal_por_unidade = valor_total / quantidade / vigencia_meses
```

Regras já documentadas em [01_initial_schema.sql](../../infra/migrations/) e [tools/normalizacao.py](../../backend/tools/normalizacao.py).

---

## Busca negativa

Endpoint dedicado: `POST /proc/contratacoes/{id}/pesquisas-negativas`.

Também é gerada **automaticamente** pelo `PrecosAgent` quando uma busca em PNCP/Compras retorna 0 resultados para um termo:

```python
async def buscar_com_registro_negativo(termo: str, contratacao_id: UUID) -> list[ItemMercado]:
    resultados = await pncp.buscar(termo)
    if not resultados:
        await db.execute("""
            INSERT INTO pesquisas_negativas
              (contratacao_id, termo, fontes_consultadas, justificativa, efeito_na_estimativa)
            VALUES ($1, $2, $3, $4, $5)
        """, contratacao_id, termo,
             ['PNCP', 'Compras.gov'],
             'Termo não retornou resultados nas bases consultadas',
             'Sistema usará referência paramétrica baseada em produto similar')
    return resultados
```

No documento gerado (ETP/TR), as buscas negativas aparecem como nota de rodapé:
> _"O preço de referência para [Produto X] foi obtido por método paramétrico, dado que pesquisa direta nas bases PNCP, Compras.gov e Painel de Preços (em DD/MM/AAAA) não retornou resultados (registro #PN-001)."_

---

## Memória de cálculo (sempre obrigatória)

Para cada item do mapa de preços, gera-se uma "memória" textual estruturada:

```
Item: Gemini Enterprise Plus
Quantidade: 70 licenças
Vigência: 36 meses

Fontes diretas (3):
  - PRODEMGE: R$ 174,00 / licença / mês  [score 0.82, alta]
  - ARTESP:   R$ 257,65 / licença / mês  [score 0.74, alta]
  - PRODESP:  R$ 198,00 / licença / mês  [score 0.71, alta]

Fontes complementares (1):
  - Tarumã: R$ 102,61 / licença / mês  [score 0.42, média; baixa escala]

Outliers descartados (1):
  - Marketplace XYZ: R$ 1.200,00  [score 0.10, descartada — não oficial]

Métrica adotada: mediana das fontes diretas
Preço de referência: R$ 198,00 / licença / mês
Total para a contratação: 70 × R$ 198,00 × 36 = R$ 498.960,00
```

Renderizada como bloco "Memória de Cálculo" no Mapa de Preços e no anexo do ETP.

---

## Endpoints relacionados

Ver [04_API_CONTRACT.md §4](./04_API_CONTRACT.md).

---

## UX do Price Board

Tela `/contratacoes/[id]/precos`:
- Tabs por classificação: **Diretas | Indiretas | Paramétricas | Complementares | Outliers | Descartadas | Buscas negativas**
- Cada card de fonte: produto · valor · vigência · score (barra) · classificação (chip) · ações (validar/descartar/reclassificar)
- Bloco "Memória de cálculo" por item de quantidade
- Botão "Adicionar fonte" abre modal com 4 abas (URL · texto · arquivo · print)
- Indicador de readiness para Mapa de Preços (mini)

---

## DoD do Price Workbench

- [ ] Usuário consegue colar URL PNCP no chat e ver fonte validada na sidebar em ≤ 30s
- [ ] Cada item de mercado tem `classificacao` preenchida (nunca null após validação)
- [ ] Memória de cálculo gerada automaticamente para cada item de quantidade
- [ ] Busca negativa registrada quando PNCP/Compras retorna 0 para um termo
- [ ] Guardrails G3 (marketplace), G6 (sem data/origem), G11 (paramétrico) impedem inserção indevida
- [ ] Mapa de preços exporta em XLSX com aba "Memória de cálculo"
