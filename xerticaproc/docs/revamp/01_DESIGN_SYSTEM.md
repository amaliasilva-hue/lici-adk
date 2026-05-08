# 01 — Design System Xertica para xerticaproc

---

## 1. Decisão arquitetural: Tailwind v4 vs alternativa

### Diagnóstico

- Tailwind CSS v4 está configurado mas **não aplica classes consistentemente em produção**
- Apenas a tela `/auth/signin` (com inline styles) tem visual premium
- O irmão `lici-adk/web` usa Tailwind v3 + tokens em `globals.css` e funciona

### Decisão

**Migrar `xerticaproc/web` de Tailwind v4 → Tailwind v3.4 + tokens CSS** (mesma estratégia do `lici-adk/web`).

**Justificativa:**
- v3 é estável, documentado, debug fácil em produção
- Já temos a referência funcional de tokens em [brandbookstyle.css](../../../brandbookstyle.css) e [web/src/app/globals.css](../../../web/src/app/globals.css)
- v4 é jovem demais para um sistema crítico em produção; o ganho de DX não compensa o risco
- Inline styles em telas grandes não escalam — Tailwind v3 + CSS variables resolve

### Plano de migração
1. `package.json`: substituir `tailwindcss@4` por `tailwindcss@^3.4`, adicionar `postcss`, `autoprefixer`
2. `tailwind.config.ts`: configurar `content`, mapear cores Xertica como `theme.extend.colors`
3. `globals.css`: importar `@tailwind base/components/utilities` (v3 syntax) + tokens Xertica
4. Remover inline styles do `/auth/signin`, reescrever com Tailwind + tokens

---

## 2. Tokens (CSS variables)

```css
:root {
  /* ── Brand colors ──────────────────────────────────── */
  --x-bg-deep:        #080F1A;     /* fundo principal */
  --x-bg-surface:     rgba(13,19,31,0.55);
  --x-cyan:           #00BCD4;     /* primário (CTA, links) */
  --x-cyan-glow:      rgba(0,188,212,0.45);
  --x-blue:           #1E5FA8;     /* secundário (nav active, badges info) */
  --x-blue-glow:      rgba(30,95,168,0.45);
  --x-green:          #C0FF7D;     /* sucesso, status confirmado */
  --x-green-bg:       rgba(192,255,125,0.12);
  --x-pink:           #FF89FF;     /* destaque, acentos secundários */
  --x-orange:         #FFB340;     /* avisos */
  --x-red:            #F87171;     /* erro, bloqueante */

  /* ── Glass / surface ──────────────────────────────── */
  --x-glass-bd:       rgba(255,255,255,0.08);
  --x-glass-hl:       rgba(255,255,255,0.10);
  --x-glass-bg:       rgba(255,255,255,0.04);

  /* ── Text ─────────────────────────────────────────── */
  --x-text-1:         #F1F5F9;     /* primário */
  --x-text-2:         #CBD5E1;     /* secundário */
  --x-text-3:         #94A3B8;     /* muted */
  --x-text-4:         #64748B;     /* extra muted */

  /* ── Status semantic ──────────────────────────────── */
  --st-confirmado:    var(--x-green);
  --st-inferido:      var(--x-cyan);
  --st-pendente:      var(--x-orange);
  --st-bloqueante:    var(--x-red);
  --st-dispensado:    var(--x-text-3);

  /* ── Tipografia ───────────────────────────────────── */
  --font-display:     'Poppins', system-ui, sans-serif;
  --font-body:        'Inter', system-ui, sans-serif;
  --font-mono:        'JetBrains Mono', monospace;

  /* ── Espaçamento (mantém escala Tailwind) ─────────── */
  /* já vem do Tailwind: 0.5/1/1.5/2/3/4/6/8/12/16... */

  /* ── Raios ────────────────────────────────────────── */
  --r-sm:  0.5rem;
  --r-md:  0.75rem;
  --r-lg:  1rem;
  --r-xl:  1.5rem;
  --r-2xl: 2rem;
  --r-full: 9999px;

  /* ── Sombra ───────────────────────────────────────── */
  --shadow-glow-cyan: 0 0 24px var(--x-cyan-glow);
  --shadow-glow-blue: 0 0 24px var(--x-blue-glow);
  --shadow-card:      0 8px 24px rgba(0,0,0,0.35);
  --shadow-elev:      0 16px 48px rgba(0,0,0,0.45);
}
```

---

## 3. Tailwind config

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        'bg-deep': 'var(--x-bg-deep)',
        cyan:  { DEFAULT: 'var(--x-cyan)', glow: 'var(--x-cyan-glow)' },
        blue:  { DEFAULT: 'var(--x-blue)', glow: 'var(--x-blue-glow)' },
        green: { DEFAULT: 'var(--x-green)', bg: 'var(--x-green-bg)' },
        pink:  'var(--x-pink)',
        orange:'var(--x-orange)',
        red:   'var(--x-red)',
        text:  {
          1: 'var(--x-text-1)',
          2: 'var(--x-text-2)',
          3: 'var(--x-text-3)',
          4: 'var(--x-text-4)',
        },
        st: {
          confirmado: 'var(--st-confirmado)',
          inferido:   'var(--st-inferido)',
          pendente:   'var(--st-pendente)',
          bloqueante: 'var(--st-bloqueante)',
          dispensado: 'var(--st-dispensado)',
        },
      },
      fontFamily: {
        display: 'var(--font-display)',
        body:    'var(--font-body)',
        mono:    'var(--font-mono)',
      },
      borderRadius: {
        sm:  'var(--r-sm)',
        md:  'var(--r-md)',
        lg:  'var(--r-lg)',
        xl:  'var(--r-xl)',
        '2xl':'var(--r-2xl)',
      },
      boxShadow: {
        'glow-cyan': 'var(--shadow-glow-cyan)',
        'glow-blue': 'var(--shadow-glow-blue)',
        'card':      'var(--shadow-card)',
        'elev':      'var(--shadow-elev)',
      },
      animation: {
        'orb-float': 'orbFloat 16s ease-in-out infinite',
        'fade-up':   'fadeUp 360ms ease-out both',
        'pulse-soft':'pulseSoft 2.4s ease-in-out infinite',
      },
      keyframes: {
        orbFloat: {
          '0%,100%': { transform: 'translate(0,0)' },
          '50%':     { transform: 'translate(40px,-30px)' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '0.7' },
          '50%':     { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
```

---

## 4. Tipografia

| Token | Família | Tamanho | Peso | Uso |
|---|---|---|---|---|
| `display-2xl` | Poppins | 56px / 1.05 | 700 | Hero principal (1 por tela) |
| `display-xl`  | Poppins | 40px / 1.1  | 700 | Hero secundário |
| `display-lg`  | Poppins | 32px / 1.15 | 600 | Heading de seção |
| `display-md`  | Poppins | 24px / 1.2  | 600 | Heading de card |
| `display-sm`  | Poppins | 20px / 1.25 | 600 | Subseção |
| `body-lg`     | Inter   | 18px / 1.55 | 400 | Texto destacado |
| `body`        | Inter   | 15px / 1.6  | 400 | Texto padrão |
| `body-sm`     | Inter   | 13px / 1.55 | 400 | Texto muted, labels |
| `mono`        | JetBrains Mono | 13px / 1.45 | 500 | Hashes, IDs, valores numéricos |

Implementadas como utility classes em `globals.css`:

```css
.t-display-2xl { font: 700 56px/1.05 var(--font-display); letter-spacing: -0.02em; }
.t-display-xl  { font: 700 40px/1.1  var(--font-display); letter-spacing: -0.02em; }
.t-display-lg  { font: 600 32px/1.15 var(--font-display); letter-spacing: -0.01em; }
.t-display-md  { font: 600 24px/1.2  var(--font-display); }
.t-display-sm  { font: 600 20px/1.25 var(--font-display); }
.t-body-lg     { font: 400 18px/1.55 var(--font-body); }
.t-body        { font: 400 15px/1.6  var(--font-body); }
.t-body-sm     { font: 400 13px/1.55 var(--font-body); }
.t-mono        { font: 500 13px/1.45 var(--font-mono); }
```

---

## 5. Componentes base (shadcn-style, internos)

Localização: `xerticaproc/web/src/components/ui/`

| Componente | Variantes | Estado |
|---|---|---|
| `Button` | `primary`, `secondary`, `ghost`, `danger`, `link` | hover, focus, disabled, loading |
| `Card` | `default`, `glass`, `elev` | hover (lift) |
| `Badge` | `confirmado`, `inferido`, `pendente`, `bloqueante`, `dispensado`, `info` | — |
| `Input` | `text`, `textarea` | focus ring cyan, error red |
| `Select` | nativo + custom | — |
| `Tabs` | pill style | active, hover |
| `Avatar` | size `sm/md/lg`, fallback iniciais | online dot opcional |
| `Tooltip` | top/right/bottom/left | aparece em hover/focus |
| `Toast` | `success/info/warning/error` | auto-dismiss 4s |
| `Modal` | `sm/md/lg/full` | backdrop blur |
| `Skeleton` | linha, bloco, avatar | shimmer animado |
| `EmptyState` | ícone + título + descrição + CTA | — |
| `ScoreIndicator` | barra 0–1, gradiente cyan→green | mostra threshold |
| `StatusDot` | confirmado/inferido/pendente/bloqueante | tooltip |
| `ChecklistItem` | label + status + valor + evidence | clicável (abre detalhe) |
| `SourceCard` | tipo + url + valor + score + classificação | actions (validar/descartar) |
| `DecisionCard` | tipo + valor + justificativa + autor | timeline |
| `ChatBubble` | user/assistant/system | streaming, citação de fonte inline |

Todos com **modo dark único** (não há light mode no escopo).

---

## 6. Layouts globais

### Background efeitos

```css
/* fundo grade sutil */
.bg-grid {
  position: fixed; inset: -40px 0 0 0; z-index: -2; pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse at top, black 0%, transparent 80%);
}

/* orbs animados */
.bg-orbs::before, .bg-orbs::after {
  content: ''; position: fixed; z-index: -1; border-radius: 50%; filter: blur(80px); opacity: 0.4;
  animation: orbFloat 16s ease-in-out infinite;
}
.bg-orbs::before { background: var(--x-cyan); width: 480px; height: 480px; top: -120px; left: -120px; }
.bg-orbs::after  { background: var(--x-blue); width: 520px; height: 520px; bottom: -160px; right: -120px; animation-delay: -8s; }
```

### Glassmorphism

```css
.glass {
  background: var(--x-glass-bg);
  border: 1px solid var(--x-glass-bd);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-radius: var(--r-xl);
}
.glass-elev {
  @apply glass;
  box-shadow: var(--shadow-elev);
}
```

---

## 7. AppShell (estrutura comum)

```
┌─────────────────────────────────────────────────────┐
│  [logo X]  xerticaproc                  [user ▾]    │  ← header (h-16, glass)
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│  side    │            CONTEÚDO DA PÁGINA            │
│  nav     │            (max-w-7xl, padding 6/8)      │
│  (w-64)  │                                          │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

Side nav (vertical):
- 🏠 Início (dashboard)
- 📋 Contratações (lista)
- 💬 Workspace ativo (quando dentro de uma)
- 📚 Histórico
- ⚙️  Configurações

---

## 8. Motion design

| Elemento | Animação | Duração |
|---|---|---|
| Página entra | fade-up | 360ms |
| Card aparece em lista | stagger fade-up | 60ms entre cards |
| Hover em card clicável | translateY(-2px) + glow | 180ms |
| Botão click | scale(0.98) | 80ms |
| Toast aparece | slide-in-right + fade | 240ms |
| Modal abre | fade backdrop + scale 0.96→1 | 200ms |
| Streaming de chat | typing indicator (3 dots pulse) | infinito |
| Checklist item muda status | fade do dot + scale | 240ms |

Respeitar `prefers-reduced-motion: reduce` desabilitando todas as animações decorativas.

---

## 9. Telas redesenhadas (escopo)

| Tela | Antes | Depois |
|---|---|---|
| `/auth/signin` | inline styles ✅ | Tailwind + tokens |
| `/` (dashboard) | lista simples | Hero + cards de contratações ativas + KPIs |
| `/contratacoes` | lista | Tabela glass + filtros + status pills |
| `/contratacoes/nova` | form linear | **Substituído por chat** + form avançado opcional |
| `/contratacoes/[id]` | painel de status | **Workspace híbrido** (chat + checklist + price-board) |
| `/contratacoes/[id]/etp` | preview cru | Preview formatado + side panel de evidências |
| `/contratacoes/[id]/tr`  | idem | idem |
| `/contratacoes/[id]/precos` | tabela | Mapa de preços com classificação visual |

Detalhamento das telas em [07_UX_SCREENS.md](./07_UX_SCREENS.md).

---

## 10. Auditoria visual (DoD do design system)

Antes de marcar o design system como pronto:

- [ ] Tokens implementados em `globals.css`
- [ ] `tailwind.config.ts` referenciando tokens
- [ ] Todos os componentes em `components/ui/` com props tipadas
- [ ] Storybook (ou página `/_dev/components`) listando todos os componentes em todas as variantes
- [ ] Auditoria lado-a-lado com `mockapp.html` / `mocksugerido.html` / `mocksugestao2.html`
- [ ] `prefers-reduced-motion` testado
- [ ] Lighthouse: contraste AA em todo texto, sem layout shift
