# 🎨 Revamp Visual — Xertica Lici
> Referência: `mocksugerido.html` como design-alvo  
> Stack: Next.js 14 · Tailwind CSS · TypeScript  
> Última atualização: 2026-05-05

---

## 🏷️ FASE 0 — NOMENCLATURA: Identidade Xertica
> **Prioridade: IMEDIATA** · Executar antes de qualquer outra fase  
> Eliminar termos genéricos ("B2G", "Co-pilot AI", "Sales Intelligence") substituindo-os por nomes próprios da marca Xertica.

### Tabela de Renomes

| Onde | String atual | String nova | Arquivo |
|---|---|---|---|
| Sidebar — subtítulo do usuário | `B2G Intelligence` | `Inteligência Licitatória` | `app-shell.tsx` |
| Nav — label do item principal | `Pipeline B2G` | `Pipeline Licitatório` | `nav-links.tsx` |
| Header — título da página | `Sales Intelligence Hub` | `Central de Editais` | `app-shell.tsx` |
| Botão do header | `Co-pilot AI` | `Lici IA` | `app-shell.tsx` |
| CSS — classe do botão | `.copilot-btn` | `.lici-ai-btn` | `globals.css` |
| Meta title do app | `Licitações · Xertica` | `Lici · Xertica` | `layout.tsx` |

### Lógica de Nomenclatura
- **Lici** — nome do produto (derivado do repo `lici-adk`); usado em funcionalidades de IA e títulos curtos
- **Central de Editais** — nome da interface principal; descritivo e sem anglicismo
- **Pipeline Licitatório** — nome do kanban; terminologia jurídica/comercial adequada ao domínio
- **Inteligência Licitatória** — subtítulo da plataforma; reforça o diferencial de IA + licitações

---

### 📋 LISTA: Renomes a implementar

#### 🃏 CARD: Renomear todas as strings de nomenclatura
```
ID: F0-N1
Status: [x] Concluído
Arquivos: app-shell.tsx · nav-links.tsx · globals.css · layout.tsx
Esforço: 15 min
```

---

## 📌 QUADRO: ESTADO ATUAL vs. ALVO

| Página / Componente | Estado Atual | Alvo (mock) |
|---|---|---|
| `globals.css` | Tokens criados, mas sem aliases semânticos | Aliases + animações registradas |
| `app-shell.tsx` | Sidebar funcional, sem tooltips collapsed; nomes ✅ | Tooltips + transição suave |
| `nav-links.tsx` | Links básicos, active state simples; nomes ✅ | Active state com gradiente Xertica |
| `page.tsx` (Pipeline) | Kanban com dnd-kit, visual bom | Refinamento de cards + slide-over |
| `analises/page.tsx` | Badges Tailwind puro, sem empty state | Badges design system + skeleton |
| `historico/page.tsx` | Tabela funcional, skeleton básico | Tabela polida + filtros visuais |
| `upload/page.tsx` | Dropzone funcional, estilo inconsistente | Dropzone glassmorphism Xertica |
| `chat/page.tsx` | Chat funcional, mensagens simples | Bolhas refinadas, sidebar polida |
| `edital/[id]/page.tsx` | Desconhecido — auditar | Slide-over estilo mock |
| `components/parecer-view.tsx` | Desconhecido — auditar | Tabs + métricas visuais |

---

## 🏗️ FASE 1 — FUNDAÇÃO: Tokens & Componentes Atômicos
> **Prioridade: CRÍTICA** · Todas as fases dependem desta

---

### 📋 LISTA: globals.css — Completar Design Tokens

---

#### 🃏 CARD: Aliases semânticos de cor
```
ID: F1-T1
Status: [ ] Não iniciado
Arquivo: web/src/app/globals.css
Esforço: 30 min
```
**O que fazer:**  
Adicionar ao bloco `:root` em `globals.css`:
```css
/* Semantic color aliases */
--color-success:        var(--x-green-100);       /* #7FA856 */
--color-success-bg:     rgba(127,168,86,0.08);
--color-success-border: rgba(127,168,86,0.3);
--color-success-text:   #5A7A3A;

--color-warning:        #F59E0B;
--color-warning-bg:     rgba(245,158,11,0.08);
--color-warning-border: rgba(245,158,11,0.3);
--color-warning-text:   #92400E;

--color-danger:         var(--x-red-50);           /* #E14849 */
--color-danger-bg:      rgba(148,51,53,0.08);
--color-danger-border:  rgba(148,51,53,0.3);
--color-danger-text:    var(--x-red-100);          /* #943335 */

--color-info:           var(--x-primary-100);      /* #047EA9 */
--color-info-bg:        rgba(4,126,169,0.06);
--color-info-border:    rgba(4,126,169,0.2);
```
**Impacto:** Elimina hardcodes em toda a codebase.

---

#### 🃏 CARD: Animações globais registradas
```
ID: F1-T2
Status: [ ] Não iniciado
Arquivo: web/src/app/globals.css
Esforço: 20 min
```
**O que fazer:**  
Adicionar ao final de `globals.css` (antes do último `}`):
```css
/* ── Animations ─────────────────────────────────────────────────── */
@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes slideInLeft  { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes slideUp      { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes fadeIn       { from { opacity: 0; } to { opacity: 1; } }
@keyframes scaleIn      { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes shimmer      { from { background-position: -200% 0; } to { background-position: 200% 0; } }

.anim-slide-right { animation: slideInRight 0.4s cubic-bezier(0.16,1,0.3,1) forwards; }
.anim-slide-left  { animation: slideInLeft  0.3s cubic-bezier(0.16,1,0.3,1) forwards; }
.anim-slide-up    { animation: slideUp      0.3s cubic-bezier(0.16,1,0.3,1) forwards; }
.anim-fade        { animation: fadeIn       0.2s ease-out forwards; }
.anim-scale       { animation: scaleIn      0.2s cubic-bezier(0.16,1,0.3,1) forwards; }

.skeleton {
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 6px;
}
```
**Impacto:** `.anim-*` e `.skeleton` usados em todas as páginas.

---

#### 🃏 CARD: Classes utilitárias de tabela
```
ID: F1-T3
Status: [ ] Não iniciado
Arquivo: web/src/app/globals.css
Esforço: 15 min
```
**O que fazer:**  
Centralizar o estilo `.data-table` (atualmente duplicado em páginas individuais):
```css
/* ── Data Table ──────────────────────────────────────────────────── */
.data-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.data-table th {
  background: var(--bg-app);
  color: var(--text-muted);
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  font-weight: 700; font-family: var(--font-heading);
  text-align: left; padding: 11px 16px;
  border-bottom: 1px solid var(--border-light);
  position: sticky; top: 0; z-index: 10;
  white-space: nowrap;
}
.data-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-light);
  font-size: 13px; color: var(--text-body);
  vertical-align: middle;
  transition: background 0.15s;
}
.data-table tbody tr { cursor: pointer; }
.data-table tbody tr:hover td { background: rgba(4,126,169,0.03); }
.data-table tbody tr:last-child td { border-bottom: none; }
```

---

### 📋 LISTA: Componentes UI Atômicos — criar `/web/src/components/ui/`

---

#### 🃏 CARD: Badge.tsx — componente unificado
```
ID: F1-C1
Status: [ ] Não iniciado
Arquivo: web/src/components/ui/Badge.tsx (CRIAR)
Esforço: 25 min
Dependência: F1-T1 (tokens semânticos)
```
**Problema atual:**  
- `analises/page.tsx` usa `bg-green-100 text-green-800` (Tailwind padrão)  
- `historico/page.tsx` usa `.badge .badge-green` (classes CSS custom)  
- `page.tsx` usa `<Badge style={{...}}>` com inline styles

**Solução — interface:**
```ts
type BadgeVariant = 
  | 'success' | 'warning' | 'danger' | 'info'
  | 'neutral' | 'phase'    | 'mono'
  | 'apto'    | 'ressalvas' | 'inapto' | 'nogo';

interface BadgeProps {
  variant?: BadgeVariant;
  phase?: { color: string; bg: string };  // para fases customizadas
  size?: 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
}
```
**Substituir em:** `analises/page.tsx`, `historico/page.tsx`, `page.tsx`

---

#### 🃏 CARD: ScoreIndicator.tsx
```
ID: F1-C2
Status: [ ] Não iniciado
Arquivo: web/src/components/ui/ScoreIndicator.tsx (CRIAR)
Esforço: 20 min
```
**Problema atual:**  
`ScoreBadge` existe duplicado em `page.tsx`, `analises/page.tsx` e `historico/page.tsx` com lógica ligeiramente diferente (threshold 70 vs 75).

**Interface alvo:**
```ts
interface ScoreIndicatorProps {
  score?: number | null;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  thresholds?: { good: number; warning: number }; // default: 75 / 55
}
```
Icone brain SVG + cor semântica. Usar tokens `--color-success-*`, `--color-warning-*`, `--color-danger-*`.

---

#### 🃏 CARD: Avatar.tsx — gradiente Xertica
```
ID: F1-C3
Status: [ ] Não iniciado
Arquivo: web/src/components/ui/Avatar.tsx (CRIAR)
Esforço: 15 min
```
**Interface:**
```ts
interface AvatarProps {
  name?: string;
  email?: string;
  size?: number; // default 28
  className?: string;
}
```
Gradiente: `from-[#047EA9] to-[#00BEFF]`. Extrair iniciais de email ou nome.

---

#### 🃏 CARD: Button.tsx — variants padronizados
```
ID: F1-C4
Status: [ ] Não iniciado
Arquivo: web/src/components/ui/Button.tsx (CRIAR)
Esforço: 20 min
```
**Variants:** `primary | secondary | ghost | danger | ai`  
O variant `ai` = fundo `#E6F7FF`, texto `#047EA9`, borda `#BAE6FD`, hover → fundo `#047EA9` texto branco. Usado no botão **Lici IA** e "Gerar Proposta".

---

#### 🃏 CARD: EmptyState.tsx — para listas vazias
```
ID: F1-C5
Status: [ ] Não iniciado
Arquivo: web/src/components/ui/EmptyState.tsx (CRIAR)
Esforço: 20 min
```
**Uso:** `analises/page.tsx`, `historico/page.tsx`, `page.tsx` (kanban colunas vazias)  
SVG ilustração minimalista + título + subtítulo + botão opcional.

---

#### 🃏 CARD: index.ts — barrel export
```
ID: F1-C6
Status: [ ] Não iniciado
Arquivo: web/src/components/ui/index.ts (CRIAR)
Esforço: 5 min
Dependência: F1-C1 a F1-C5
```
```ts
export { default as Badge } from './Badge';
export { default as ScoreIndicator } from './ScoreIndicator';
export { default as Avatar } from './Avatar';
export { default as Button } from './Button';
export { default as EmptyState } from './EmptyState';
```

---

## 🧩 FASE 2 — SIDEBAR & SHELL
> **Prioridade: ALTA** · Afeta todas as páginas

---

### 📋 LISTA: app-shell.tsx — melhorias

---

#### 🃏 CARD: Tooltips no modo collapsed
```
ID: F2-S1
Status: [ ] Não iniciado
Arquivo: web/src/components/app-shell.tsx + nav-links.tsx
Esforço: 40 min
```
**Problema:** Em modo collapsed (sidebar 72px), os labels somem mas não há tooltip.  
**Solução:** Adicionar `title` nos links + CSS tooltip nativo via `::after` pseudo-element em `.sidebar-shell[data-collapsed] .nav-item` — sem biblioteca extra.

---

#### 🃏 CARD: Active nav item — gradiente Xertica
```
ID: F2-S2
Status: [ ] Não iniciado
Arquivo: web/src/components/nav-links.tsx
Esforço: 20 min
```
**Problema atual:** Active state usa `bg-[#047EA9]/20 text-[#047EA9]` (opacidade plana).  
**Alvo (mock):** `bg-gradient-to-r from-[#047EA9] to-[#038CBC] text-white shadow-md` — igual ao mock.  
**Também:** Dot indicator `w-1 h-1 rounded-full bg-white absolute right-2` quando ativo em modo collapsed.

---

#### 🃏 CARD: Header — search bar centralizada
```
ID: F2-S3
Status: [ ] Não iniciado
Arquivo: web/src/components/app-shell.tsx
Esforço: 30 min
```
**Melhorias:**
- Search trigger com `⌘K` kbd pill (já existe, verificar se está sendo renderizado)
- Adicionar `focus-within:border-[#047EA9] focus-within:shadow-[0_0_0_3px_rgba(4,126,169,0.12)]` no container do search
- Botão **Lici IA** com variant `ai` do `Button.tsx` (F1-C4)

---

#### 🃏 CARD: Sidebar — user area refinada
```
ID: F2-S4
Status: [ ] Não iniciado
Arquivo: web/src/components/app-shell.tsx
Esforço: 15 min
```
**Melhorias:**  
Trocar o div `XE` estático pelo componente `Avatar` (F1-C3) com nome do usuário da sessão NextAuth.

---

## 📊 FASE 3 — PÁGINA: Pipeline Licitatório (page.tsx)
> **Prioridade: ALTA** · Página principal, já mais polida

---

#### 🃏 CARD: KanbanCard — hover e sombra elevada
```
ID: F3-K1
Status: [ ] Não iniciado
Arquivo: web/src/app/page.tsx
Esforço: 25 min
```
**Melhorias:**
- Borda colorida no topo do card (`border-t-2`) com a cor da fase quando hover
- Sombra `shadow-md` no hover com tint da cor primária: `0 8px 25px rgba(4,126,169,0.12)`
- `ScoreIndicator` → migrar para componente F1-C2
- `MiniAvatar` → migrar para `Avatar` (F1-C3)

---

#### 🃏 CARD: Coluna vazia — empty state visual
```
ID: F3-K2
Status: [ ] Não iniciado
Arquivo: web/src/app/page.tsx
Esforço: 15 min
```
Quando `items.length === 0`, mostrar `EmptyState` (F1-C5) compacto com ícone e mensagem "Nenhum edital aqui".

---

#### 🃏 CARD: Slide-over do edital — botão "Ver Parecer"
```
ID: F3-K3
Status: [ ] Não iniciado
Arquivo: web/src/app/page.tsx + web/src/components/parecer-view.tsx
Esforço: 60 min
```
**Objetivo:** O slide-over no mock (`ParecerSlideOver`) tem:
- Header escuro `bg-slate-900` com número do pregão + data
- Grid 4 colunas com métricas (score, valor, fase, responsável)
- Tabs: Resumo IA / Requisitos / Financeiro
- Footer com ações (comentário, gerar proposta)

Auditar `parecer-view.tsx` atual e alinhar ao padrão do mock.

---

## 📋 FASE 4 — PÁGINA: Análises (analises/page.tsx)
> **Prioridade: ALTA** · Segunda página mais usada

---

#### 🃏 CARD: Migrar badges de status
```
ID: F4-A1
Status: [ ] Não iniciado
Arquivo: web/src/app/analises/page.tsx
Esforço: 20 min
Dependência: F1-C1
```
**Substituições:**
```tsx
// ANTES
function badge(s: string) {
  if (s === 'APTO') return 'bg-green-100 text-green-800';
  if (s === 'APTO COM RESSALVAS') return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}
// ↓
// DEPOIS — usar <Badge variant="apto"|"ressalvas"|"inapto"> de F1-C1
```

---

#### 🃏 CARD: Loading skeleton refinado
```
ID: F4-A2
Status: [ ] Não iniciado
Arquivo: web/src/app/analises/page.tsx
Esforço: 20 min
Dependência: F1-T2 (classe .skeleton)
```
**Atual:** Sem skeleton visível (só spinner de texto?).  
**Alvo:** 5 linhas de skeleton com animação shimmer para cada coluna da tabela.

---

#### 🃏 CARD: Empty state
```
ID: F4-A3
Status: [ ] Não iniciado
Arquivo: web/src/app/analises/page.tsx
Esforço: 15 min
Dependência: F1-C5
```
Quando `rows.length === 0` após load, mostrar `EmptyState` com ícone de arquivo e CTA "Enviar primeiro edital" linkando para `/upload`.

---

#### 🃏 CARD: Filtros — pill chips visuais
```
ID: F4-A4
Status: [ ] Não iniciado
Arquivo: web/src/app/analises/page.tsx
Esforço: 30 min
```
Filtros ativos (orgao, status, uf) devem aparecer como pills removíveis abaixo do header da tabela: `[Órgão: Ministério ×]` com cor `bg-[#E6F7FF] text-[#047EA9] border-[#BAE6FD]`.

---

## 📜 FASE 5 — PÁGINA: Histórico (historico/page.tsx)
> **Prioridade: MÉDIA**

---

#### 🃏 CARD: Migrar ScoreBadge e badges
```
ID: F5-H1
Status: [ ] Não iniciado
Arquivo: web/src/app/historico/page.tsx
Esforço: 20 min
Dependência: F1-C1, F1-C2
```
`badge-green`, `badge-blue`, `badge-red` → `<Badge>` + `<ScoreIndicator>` dos componentes UI.

---

#### 🃏 CARD: Filtros refinados
```
ID: F5-H2
Status: [ ] Não iniciado
Arquivo: web/src/app/historico/page.tsx
Esforço: 25 min
```
Inputs de filtro atualmente são `<input>` e `<select>` sem estilo consistente.  
**Alvo:** Inputs com `rounded-lg border border-slate-200 focus:border-[#047EA9] focus:ring-2 focus:ring-[#047EA9]/10 bg-white px-3 py-2 text-sm`.

---

## ⬆️ FASE 6 — PÁGINA: Upload (upload/page.tsx)
> **Prioridade: MÉDIA**

---

#### 🃏 CARD: Dropzone — borda animada no drag-over
```
ID: F6-U1
Status: [ ] Não iniciado
Arquivo: web/src/app/upload/page.tsx
Esforço: 30 min
```
**Alvo:**
- Border dashed `border-2 border-dashed border-slate-300` → no drag-over: `border-[#047EA9] bg-[#E6F7FF]`
- Ícone de upload animado (translateY -4px) no drag-over
- Transição suave `transition-all duration-200`

---

#### 🃏 CARD: Progress steps visuais
```
ID: F6-U2
Status: [ ] Não iniciado
Arquivo: web/src/app/upload/page.tsx
Esforço: 35 min
```
Os stages `idle | uploading | queued | running | done | failed` devem ter uma barra de progresso visual horizontal com ícones de etapa (upload → fila → IA rodando → concluído), usando `anim-scale` para transições.

---

#### 🃏 CARD: Agent labels com spinner Xertica
```
ID: F6-U3
Status: [ ] Não iniciado
Arquivo: web/src/app/upload/page.tsx
Esforço: 20 min
```
`AGENT_LABELS` com status `running` → spinner SVG animated + texto em `font-mono text-[#047EA9]` ao invés de texto plano.

---

## 💬 FASE 7 — PÁGINA: Chat (chat/page.tsx)
> **Prioridade: MÉDIA**

---

#### 🃏 CARD: Bolhas de mensagem refinadas
```
ID: F7-C1
Status: [ ] Não iniciado
Arquivo: web/src/app/chat/page.tsx
Esforço: 30 min
```
**Alvo (baseado no mock AI sidebar):**
- Mensagem usuário: `bg-[#047EA9] text-white rounded-2xl rounded-br-sm px-4 py-3 shadow-sm`
- Mensagem assistente: `bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm`
- Mensagem assistente com resultado positivo: `border-l-2 border-l-[#7FA856]`

---

#### 🃏 CARD: Sidebar de sessões — visual polido
```
ID: F7-C2
Status: [ ] Não iniciado
Arquivo: web/src/app/chat/page.tsx
Esforço: 25 min
```
Grupos de datas (`Hoje`, `Ontem`) com label `font-bold text-[10px] uppercase tracking-widest text-slate-400 px-3 mb-1`.  
Item hover: `hover:bg-slate-50 border border-transparent hover:border-slate-200`.

---

#### 🃏 CARD: Input de mensagem — estilo premium
```
ID: F7-C3
Status: [ ] Não iniciado
Arquivo: web/src/app/chat/page.tsx
Esforço: 20 min
```
Input com `rounded-2xl border-2 border-slate-200 focus:border-[#047EA9] focus:ring-4 focus:ring-[#047EA9]/10` + botão send com gradiente Xertica.

---

## ✨ FASE 8 — POLISH FINAL
> **Prioridade: BAIXA** · Executar ao final de todas as fases

---

#### 🃏 CARD: Page transitions — anim-fade em todos os <main>
```
ID: F8-P1
Status: [ ] Não iniciado
Esforço: 20 min
```
Adicionar `className="anim-fade"` no elemento `<main>` ou no wrapper de conteúdo principal de cada página.

---

#### 🃏 CARD: Focus rings acessíveis padronizados
```
ID: F8-P2
Status: [ ] Não iniciado
Arquivo: web/src/app/globals.css
Esforço: 15 min
```
```css
:focus-visible {
  outline: 2px solid var(--x-primary-50);
  outline-offset: 2px;
  border-radius: 4px;
}
```

---

#### 🃏 CARD: Responsividade mobile — sidebar overlay
```
ID: F8-P3
Status: [ ] Não iniciado
Arquivo: web/src/components/app-shell.tsx + globals.css
Esforço: 45 min
```
Em telas < 768px, sidebar deve:
1. Ficar oculta por padrão (`translate-x-[-100%]`)
2. Abrir via hamburguer button no header
3. Backdrop overlay ao abrir
4. Fechar com ESC ou clique fora

---

#### 🃏 CARD: Notificação bell — badge de contagem
```
ID: F8-P4
Status: [ ] Não iniciado
Arquivo: web/src/components/notification-bell.tsx
Esforço: 20 min
```
Adicionar badge numérico vermelho `absolute -top-1 -right-1 w-4 h-4 bg-[#E14849] text-white text-[9px] font-bold rounded-full` quando há notificações não lidas.

---

## 📐 REFERÊNCIA: Padrões Visuais do Mock

### Cores semânticas confirmadas
| Propósito | Hex | Token |
|---|---|---|
| Primário / Info | `#047EA9` | `--x-primary-100` |
| Primário claro | `#00BEFF` | `--x-primary-50` |
| Sucesso / Apto | `#7FA856` | `--x-green-100` |
| Texto sucesso | `#5A7A3A` | — |
| Aviso | `#F59E0B` | — |
| Perigo / Inapto | `#E14849` | `--x-red-50` |
| Sidebar bg | `#0F172A` | `--bg-sidebar` |
| App bg | `#F8FAFC` | `--bg-app` |

### Raios de borda
| Elemento | Valor |
|---|---|
| Cards principais | `rounded-2xl` (16px) |
| Cards internos | `rounded-xl` (12px) |
| Badges | `rounded` (4px) |
| Inputs | `rounded-lg` (8px) |
| Botões | `rounded-lg` (8px) |
| Avatar | `rounded-full` |

### Sombras
| Nível | CSS |
|---|---|
| sm | `0 1px 2px rgba(4,126,169,0.05)` |
| md | `0 4px 6px rgba(4,126,169,0.08)` |
| lg | `0 10px 15px rgba(4,126,169,0.10)` |

### Tipografia
| Uso | Família | Peso |
|---|---|---|
| Títulos, labels | Poppins | 600–700 |
| Corpo | Roboto | 400–500 |
| Números, código, IDs | JetBrains Mono | 400–500–700 |

---

## ✅ CHECKLIST DE CONCLUSÃO POR FASE

```
FASE 1 — Fundação
 [x] F1-T1  Aliases semânticos de cor
 [x] F1-T2  Animações globais (.anim-*, .skeleton)
 [x] F1-T3  Classes .data-table centralizadas
 [x] F1-C1  Badge.tsx
 [x] F1-C2  ScoreIndicator.tsx
 [x] F1-C3  Avatar.tsx
 [x] F1-C4  Button.tsx
 [x] F1-C5  EmptyState.tsx
 [x] F1-C6  index.ts barrel

FASE 2 — Shell
 [x] F2-S1  Tooltips collapsed sidebar
 [x] F2-S2  Active nav dot indicator collapsed
 [x] F2-S3  Header search focus ring
 [x] F2-S4  Sidebar user area com Avatar

FASE 3 — Pipeline (page.tsx)
 [x] F3-K1  KanbanCard — ScoreIndicator + Avatar (ScoreBadge/MiniAvatar removidos)
 [x] F3-K2  Coluna vazia → EmptyState component
 [x] F3-K3  parecer-view.tsx → Badge migration

FASE 4 — Análises
 [x] F4-A1  Badges de status migradas → Badge component
 [x] F4-A2  Skeleton loading → skeleton rows
 [x] F4-A3  Empty state → EmptyState component
 [ ] F4-A4  Filtros pill chips

FASE 5 — Histórico
 [x] F5-H1  Badges migradas → Badge + ScoreIndicator
 [x] F5-H2  Filtros refinados (EmptyState + data-table)

FASE 6 — Upload
 [x] F6-U1  Dropzone drag-over (CSS melhorado)
 [x] F6-U2  Progress steps visuais → CSS vars semânticos
 [x] F6-U3  Agent labels spinner → font-mono + x-cyan

FASE 7 — Chat
 [x] F7-C1  Bolhas de mensagem (já implementadas corretamente)
 [x] F7-C2  Sidebar sessões → label color + empty state fix
 [x] F7-C3  Input premium (já implementado corretamente)

FASE 8 — Polish
 [x] F8-P1  Page transitions → anim-fade em todas as páginas
 [x] F8-P2  Focus rings → :focus-visible global
 [ ] F8-P3  Responsividade mobile
 [x] F8-P4  Notification bell badge → cor #E14849
```

---

> **Nota:** Cada card neste doc corresponde a uma PR ou commit atômico.  
> Ordem de execução recomendada: Fase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.  
> Fases 3–7 podem ser paralelizadas após Fase 1 estar completa.
