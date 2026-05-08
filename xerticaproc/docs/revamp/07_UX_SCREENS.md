# 07 — UX Screens (Wireframes)

Brand visual segue [01_DESIGN_SYSTEM.md](./01_DESIGN_SYSTEM.md). Tudo em dark mode (`#080F1A` base).

## Mapa de telas

| Rota | Propósito |
|---|---|
| `/` | Login (Google, restrito @xertica.com) |
| `/dashboard` | Dashboard executivo (cards + funil + lista recentes) |
| `/contratacoes` | Lista/grid de contratações com filtros |
| `/contratacoes/nova` | Criação rápida (3 perguntas + chat assume) |
| `/contratacoes/[id]` | **Workspace híbrido** (chat + checklist + decisões) |
| `/contratacoes/[id]/precos` | Price Workbench (tela cheia) |
| `/contratacoes/[id]/etp` | Preview do ETP (split: doc + chat lateral) |
| `/contratacoes/[id]/tr` | Preview do TR (idem) |
| `/contratacoes/[id]/mapa-precos` | Mapa de preços + memória de cálculo |
| `/contratacoes/[id]/evidencias` | Pacote de evidências (download .zip) |
| `/contratacoes/[id]/historico` | Timeline imutável (mensagens + decisões + revisões) |
| `/admin/templates` | Curadoria de templates ETP/TR |
| `/admin/profiles` | Perfis de pesquisa (cliente) |
| `/admin/usuarios` | Gestão de usuários e papéis |

## AppShell (todas as telas autenticadas)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [orb radial cyan @ top-left, blue @ bottom-right, opacity 30%]           │
│                                                                          │
│ ╔══════════╗  ╔══════════════════════════════════════════════════════╗  │
│ ║          ║  ║  TopBar: breadcrumbs · search · notif · user-menu    ║  │
│ ║ SIDEBAR  ║  ╠══════════════════════════════════════════════════════╣  │
│ ║          ║  ║                                                      ║  │
│ ║ logo X.  ║  ║                  CONTEÚDO                            ║  │
│ ║          ║  ║                                                      ║  │
│ ║ Dashboard║  ║                                                      ║  │
│ ║ Contrat. ║  ║                                                      ║  │
│ ║ Templates║  ║                                                      ║  │
│ ║ Admin    ║  ║                                                      ║  │
│ ║          ║  ║                                                      ║  │
│ ║ ──────── ║  ║                                                      ║  │
│ ║ user▼    ║  ║                                                      ║  │
│ ╚══════════╝  ╚══════════════════════════════════════════════════════╝  │
└──────────────────────────────────────────────────────────────────────────┘
```

Sidebar: glass `--glass-1`, 240px. Active item: borda esquerda `--x-cyan` 3px.

## Tela: Workspace `/contratacoes/[id]`

Layout 3 colunas em desktop (≥1280px), accordion em mobile.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar:  ‹ Contratações  ›  Gemini Enterprise — DESO        [Aprovar]   │
│          status chip "Em análise"  ·  readiness 67% ⓘ                   │
├──────────────┬───────────────────────────────────┬───────────────────────┤
│              │                                   │                       │
│  CHECKLIST   │             CHAT                  │   DECISÕES & FONTES   │
│   (sidebar)  │    (centro, conversational UI)    │      (sidebar)        │
│              │                                   │                       │
│ ▼ Demanda    │ ┌─────────────────────────────┐  │ Decisões (8)          │
│  ✓ Problema  │ │ assistente · 14:02          │  │ ───────────────       │
│  ✓ Objetivo  │ │ Identifiquei 3 fontes para  │  │ ◆ Modalidade: Pregão  │
│  ○ Unidade   │ │ Gemini Enterprise. Posso    │  │   "Decisão usuário"   │
│              │ │ usar a mediana de R$ 198?   │  │   14:00               │
│ ▼ Escopo     │ │ [Sim, usar] [Mostrar fontes]│  │                       │
│  ✓ Modal.    │ └─────────────────────────────┘  │ ◆ Lote único          │
│  ✓ RP        │                                   │   "integração"       │
│  ✓ Lote      │ ┌─────────────────────────────┐  │   13:55               │
│  ! Prazo     │ │ você · 14:01                │  │                       │
│              │ │ Vai ser lote único, justi-  │  │ ───────────────       │
│ ▼ Preços (3) │ │ ficar por integração        │  │ Fontes (12)           │
│  ✓ Diretas   │ └─────────────────────────────┘  │ • PRODEMGE  ✓ direta  │
│  ✓ Memória   │                                   │ • ARTESP    ✓ direta  │
│  ! Negativa  │  ▾ scroll histórico…             │ • PRODESP   ✓ direta  │
│              │                                   │ • Tarumã    ⚠ outlier │
│ ▼ Jurídico   │ ─────────────────────────────    │                       │
│  ○ 14.133    │ ┌─────────────────────────────┐  │ [+ Adicionar fonte]   │
│  ○ Marca     │ │ digite ou cole link/arquivo │  │                       │
│              │ │                       [↑ enviar] │  Ações (4)            │
│ [filtrar]    │ │ 📎 anexar  💡 sugerir       │  │ → Confirmar prazo     │
│              │ └─────────────────────────────┘  │ → Adicionar fonte     │
│              │                                   │   indireta            │
│              │ Sugestão: "Confirmar prazo de    │ → Aprovar geração ETP │
│              │  vigência (item bloqueante)"     │ → Validar matriz      │
│              │                                   │   riscos              │
└──────────────┴───────────────────────────────────┴───────────────────────┘
   280px                  flexível                          320px
```

**Comportamentos chave:**
- Chat sempre tem foco no input; tecla `/` abre paleta de comandos (`/preço`, `/risco`, `/gerar etp`, `/aprovar`)
- Bolhas do assistente streaming token a token; eventos `facts_added` aparecem como toast lateral
- "Sugestão" no rodapé é o `next_best_question` do orchestrator
- Chips de ação (`[Sim, usar]`) executam tools via 1 clique → vira mensagem do usuário
- Status do checklist anima (dot pulsa cyan ao virar `confirmado`)
- Painel direito tem tabs: Decisões · Fontes · Anexos · Riscos

## Tela: `/contratacoes/[id]/precos` (Price Workbench)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹ voltar    Mapa de Preços — Gemini Enterprise         [Exportar XLSX]  │
│ Item: Gemini Enterprise Plus  ·  70 lic × 36 meses                      │
├──────────────────────────────────────────────────────────────────────────┤
│ [ Diretas (3) ]  Indiretas (1)  Paramétricas (0)  Complementares (1)    │
│  Outliers (1)    Descartadas (2)   Buscas negativas (1)                 │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│ │ PRODEMGE        │  │ ARTESP          │  │ PRODESP         │          │
│ │ Gemini Ent.     │  │ Gemini Ent.     │  │ Gemini Ent.     │          │
│ │ R$ 174,00/lic   │  │ R$ 257,65/lic   │  │ R$ 198,00/lic   │          │
│ │ vig 36m         │  │ vig 24m         │  │ vig 36m         │          │
│ │ ━━━━━━━━░░ 0.82 │  │ ━━━━━━━░░░ 0.74 │  │ ━━━━━━━░░░ 0.71 │          │
│ │ direta · ata    │  │ direta · ata    │  │ direta · ata    │          │
│ │ [✎] [↗] [✗]     │  │ [✎] [↗] [✗]     │  │ [✎] [↗] [✗]     │          │
│ └─────────────────┘  └─────────────────┘  └─────────────────┘          │
│                                                                          │
│ ─── Memória de cálculo ────────────────────────────────────────────────  │
│ Métrica: mediana de fontes diretas                                      │
│ Preço de referência: R$ 198,00 / licença / mês                          │
│ Total: 70 × R$ 198,00 × 36 = R$ 498.960,00                              │
│                                                                          │
│ [+ Adicionar fonte]                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

## Tela: `/contratacoes/[id]/etp` (Preview)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹ voltar     ETP — Gemini Enterprise           [Aprovar] [Solicit. rev.]│
│ readiness 92%  ·  campos abertos do órgão: 4                            │
├──────────────────────────────────────────────────┬───────────────────────┤
│                                                  │                       │
│        DOCUMENTO (markdown renderizado)          │   CHAT LATERAL        │
│  1. Identificação da Contratação                 │                       │
│  2. Justificativa da Necessidade                 │   "ajustar item 3.2   │
│  3. Estimativa das Quantidades                   │    para incluir SLA   │
│     ░░░ campo aberto: dotação orçamentária       │    99,5%"             │
│  4. Levantamento de Mercado                      │                       │
│     [ver mapa de preços ↗]                       │   [enviar]            │
│  5. Estimativa do Valor                          │                       │
│  6. Justificativa da Solução Escolhida           │   ─────                │
│  7. Resultados Pretendidos                       │   Histórico revisões  │
│  …                                               │   v3 · 14:23 (você)   │
│                                                  │   v2 · 13:50 (sist.)  │
│                                                  │   v1 · 11:02 (sist.)  │
└──────────────────────────────────────────────────┴───────────────────────┘
```

## Tela: `/contratacoes/nova` (Onboarding rápido)

3 perguntas full-screen (uma por vez, transição slide cyan):
1. "Qual o objeto?" (textarea grande)
2. "Qual unidade demandante?" (autocomplete)
3. "Anexar DFD ou estudos prévios?" (drop zone)

Ao submeter → cria contratação → redireciona para workspace já com chat aberto e primeira mensagem do assistente: _"Recebi sua demanda. Identifiquei X. Vamos confirmar Y antes de seguir?"_

## Tela: `/dashboard`

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Olá, Amália                                          [+ Nova contratação]│
├──────────────────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐               │
│  │ Em curso  │ │  Prontas  │ │ Aprovadas │ │  Ciclo    │               │
│  │    12     │ │     4     │ │    27     │ │  9 dias   │               │
│  │  ▲ 3 sem  │ │  ━ 0      │ │  ▲ 5 mês  │ │  ▼ -2     │               │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘               │
│                                                                          │
│  ━━━━━━━━━━━━━━━━━━━━ funil ━━━━━━━━━━━━━━━━━━━━                       │
│  Captação ▓▓▓▓▓▓ 18                                                     │
│  Análise  ▓▓▓▓ 12                                                       │
│  Pronto   ▓▓ 4                                                          │
│  Aprovado ▓ 27                                                          │
│                                                                          │
│  ─── Recentes ────────────────────────────────────────────────────────  │
│  • DESO · Gemini Enterprise Plus     em análise   readiness 67%   →    │
│  • PRODESP · Microsoft 365 E5        pronto       readiness 95%   →    │
│  • ARTESP · Cisco Umbrella           captação     readiness 12%   →    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Mobile

Workspace: chat full-screen + bottom-sheet com tabs (checklist/decisões/fontes). FAB "/" para comandos.

## Acessibilidade

- AA contrast em todos os tokens (`#FAFBFC` sobre `#080F1A` = 18:1)
- Foco visível: ring 2px `--x-cyan-glow`
- Skip-to-content em todas as páginas
- aria-live em SSE do chat
- Atalhos: `/` (comandos), `Esc` (fecha modal), `Cmd+K` (search), `Cmd+Enter` (enviar mensagem)

## Estados vazios

Cada tela tem ilustração orb sutil + CTA claro. Ex: lista de contratações vazia → "Comece pela primeira contratação" + botão grande cyan.
