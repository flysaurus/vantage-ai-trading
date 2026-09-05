# Vantage Design System — Locked Tokens & Language

This is the canonical design system for the Vantage mobile trading app. It is **locked** —
screens must reference these tokens, not invent new values. When critiquing a screenshot,
treat any deviation from these values (especially hardcoded hex colors or ad-hoc spacing)
as a consistency violation.

Source of truth: `app/globals.css` (CSS custom properties under `:root`).

---

## 1. Written description of the language

Vantage is a **dark, premium fintech** interface:

- **Canvas**: deep navy `#0a0f1e`, with a faint cyan radial glow at the top of the app background.
- **Headlines / hero numbers**: **Playfair Display italic** (serif) — used for the big portfolio
  value and emotional "reveal" lines. This is the signature typographic gesture.
- **Everything else**: **Inter** (sans) — labels, data, body, buttons. JetBrains Mono for any
  monospace/tabular data.
- **Accent**: electric cyan `#22d3ee`, used for primary CTAs, active nav, focus rings, links.
  Cyan-on-navy is the core identity pair.
- **Cards**: **frosted glass** — `rgba(255,255,255,0.05)` fill, 1px `rgba(255,255,255,0.08)`
  border, 8px backdrop blur, 16–20px radius. Surfaces should feel translucent, not solid gray.
- **P&L semantics**: gain green `#10b981`, loss red `#ef4444`, never swapped.
- **Micro-labels**: 10–11px, uppercase, letter-spaced (`0.08–0.12em`), muted `rgba(255,255,255,0.35)`.
- **CTAs**: rounded pill (`999px` radius), solid cyan fill with dark text.
- **Motion**: fast 150ms / base 300ms / slow 600ms, ease-out / ease-spring curves.

## 2. Color tokens

| Token | Value |
|---|---|
| `--bg-primary` | `#0a0f1e` |
| `--bg-card` | `#1a2235` |
| `--bg-card-hover` | `#1f2940` |
| `--bg-input` | `#1a2235` |
| `--bg-sheet` | `#131929` |
| `--bg-overlay` | `rgba(10,15,30,0.95)` |
| `--text-primary` | `#ffffff` |
| `--text-secondary` | `rgba(255,255,255,0.55)` |
| `--text-muted` | `rgba(255,255,255,0.35)` |
| `--text-accent-warm` | `#fbbf24` |
| `--accent` (cyan) | `#22d3ee` |
| `--accent-10 / -20 / -30` | `rgba(34,211,238,0.10 / 0.20 / 0.30)` |
| `--violet` | `#b389f0` |
| `--emerald` | `#3ddc97` |
| `--amber` | `#f0b73f` |
| `--red` | `#ef7b6a` |
| `--gain` | `#10b981` |
| `--loss` | `#ef4444` |
| `--warning` | `#f59e0b` |
| `--dim` | `#aab4c7` |
| `--faint` | `#8794a8` |
| `--card-bg` | `rgba(255,255,255,0.05)` |
| `--card-border` | `rgba(255,255,255,0.08)` |
| `--border-subtle` | `rgba(255,255,255,0.06)` |
| `--border-card` | `rgba(255,255,255,0.08)` |
| `--border-input` | `rgba(255,255,255,0.10)` |
| `--border-input-focus` | `#22d3ee` |

**Known hardcoded exceptions** (in `globals.css` itself — do NOT flag these as new violations,
but DO flag any *new* hardcoded hexes that aren't one of these):
`#0d9488` (logo gradient end), `#e2e8f0` (section-label), `#94a3b8` (header-pill closed),
`#64748b` / `#f1f5f9` (investor-style badge).

## 3. Spacing tokens

`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` ·
`--space-5: 20px` · `--space-6: 24px` · `--space-8: 32px` · `--space-10: 40px` · `--space-12: 48px`
(`--space-7/9/11` skipped). Cards use 18px inner padding; hero 24px top / 20px horizontal.

## 4. Radius tokens

`--radius-sm: 8px` · `--radius-input: 12px` · `--radius-button: 14px` ·
`--radius-card: 16px` · `--radius-pill: 999px`. (`.card-frost` = 20px, `.position-card` = 16px.)

## 5. Type scale

`--text-xs: 12px` · `--text-sm: 14px` · `--text-base: 15px` · `--text-lg: 18px` ·
`--text-xl: 20px` · `--text-2xl: 24px` · `--text-3xl: 30px`.
Hero value: 56px Playfair italic; hero cents: 32px.
`--font-sans: Inter` · `--font-serif: Playfair Display (italic)` · `--mono-font: JetBrains Mono`.

## 6. Component heights

`--height-input: 52px` · `--height-button: 52px` · `--height-button-sm: 40px` ·
`--height-nav: 64px` · `--height-status-bar: 44px`.

## 7. Shadows & motion

- `--shadow-card` `0 4px 24px rgba(0,0,0,0.30)` · `--shadow-modal` `0 8px 48px rgba(0,0,0,0.50)`
- `--shadow-glow` `0 0 40px rgba(34,211,238,0.25)` · `--shadow-glow-sm` `0 0 20px rgba(34,211,238,0.15)`
- durations: fast 150ms / base 300ms / slow 600ms · ease-out `cubic-bezier(0.16,1,0.3,1)` ·
  ease-spring `cubic-bezier(0.34,1.56,0.64,1)`.
