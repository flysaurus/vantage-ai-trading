# Vantage Design Constitution

Reference context for any `/redesign` or `critique_design` call.

## Audience (why every rule below exists)

Ages 18-45. Don't have time or expertise to trade themselves. Explicitly NOT looking to gamble or chase a quick buck. Every design decision should reinforce patience and discipline, never urgency or checking-in behavior.

## Theming

Three modes: **Light**, **Dark**, **System** (follows the OS-level appearance setting and updates live if the OS setting changes while the app is open — do not require a restart). Default for new users: **Light**. The toggle lives in **Settings > Preferences**.

Both palettes are first-class; neither is "legacy." Light is the default theme; Dark is a fully maintained alternative, not a fallback.

- **Theme control:** the existing placeholder control under Settings > Preferences is updated from "Dark only" to the three real options (Light / Dark / System).
- Where the component patterns further down this file cite explicit dark-canvas hex values, read them as the **Dark-theme** token and use the Light-theme equivalent token in light mode. Where earlier addenda cite dark-only hex values (e.g. the masthead orb gradient), the palettes in this section are authoritative for both themes; the addenda remain scoped to layout/behavior.

### Light theme (default)

- Canvas background: `#F5F7F4`
- Card fill (white cards): `#FFFFFF`
- "Your Portfolio" card fill: `#EAF1F0` (soft teal tint — scoped to the Your Portfolio card ONLY; this does not change the general white-card token, which stays `#FFFFFF` for Health Score, quick-links, More from Rufus, and Holdings rows)
- Hero/AI-attributed card fill (Rufus hero-deck cards — concentration risk, event-impact, bounce-back, idle-cash, Daily Brief teaser, Weekly Snapshot teaser — plus Build Basket and chat responses with embedded cards): `#17323B` (teal-tinted charcoal, replaces the earlier near-black `#10182B`; deliberate: Rufus's cards stay dark "islands" even in light theme, and this is the visual signature that makes AI-authored content identifiable at a glance). **One unified value: every hero-deck card type uses this same fill — there is no per-card-type variation.**
- Border/hairline: `#E7EAE4`
- Text primary: `#10182B` · Text secondary: `#5B6472` · Text tertiary: `#636C7D` (darkened from `#8891A6`, which only reached 2.93:1 on the canvas — see the small-text rule below)
- Text-on-hero-card primary: `#FFFFFF` · Text-on-hero-card secondary: `#C9D8D6` (slightly warmer than the earlier `#C7CEDB`, to sit correctly on the teal undertone of `#17323B`) · Text-on-hero-card tertiary: `#7C8AA0`
- Accent (links, selected states, primary CTA fill except on hero cards): `#0E8C99` — **for text under 14px use the small-label accent `#0A6B75` (`--v-accent-label`), 6.23:1**
- Semantic gain: `#1E9E5A` · Semantic loss: `#D64545` — **for text under 14px use `#15794A` (`--v-gain-label`, 5.43:1) / `#B93030` (`--v-loss-label`, 5.95:1)**
- Text on accent fill: `#FFFFFF` (when the accent is used as a *small* fill — pills, chips, filter tabs — use the deeper `#0A6B75` label accent so white text clears 6.23:1)
- Warning/attention label: `#8A5F19` (`--v-warn`; darkened from `#A9741F`, 3.27:1)
- View-only tag: text `#7D6118` on background `rgba(217,169,74,0.15)`
- Brief section tags (Daily Brief, one accent per category): MARKET `#0A6B75` (accent label) · PORTFOLIO `#15794A` (gain label) · WATCH `#8A6D1E` · EARNINGS `#5B4BC4`. These render on the white brief sheet, so all four use the AA small-label variants rather than the full-brightness canvas colors — see `--v-tag-watch` / `--v-tag-earnings` / `--v-*-label` in `app/theme.css`.
- Admin-restricted card: background `#FDF6E9`, border `#E8C976`, label `#7D6118`

#### Small-text (AA) contrast rule — applies to BOTH themes

Two different bars, and they are not interchangeable:

- **Text under 14px needs 4.5:1.** Every small colored label — category tags, section eyebrows, legend rows, "Back"/"Edit"/"Cancel" links, schedule meta, filter chips, percentages in table cells — must clear it.
- **Graphics and large text need 3:1.** Chart lines, bars, donut arcs, icons, and large display numbers keep the full-brightness palette values (`#1E9E5A` gain, `#D64545` loss, `#0E8C99` accent in light). Do not darken those to "fix" a contrast report.

So the palette carries a **label variant** of each semantic color, used only for small text:

| Role | Full (graphics/large) | Small-label (text <14px) |
| --- | --- | --- |
| gain | `#1E9E5A` | `#15794A` (`--v-gain-label`, 5.43:1) |
| loss | `#D64545` | `#B93030` (`--v-loss-label`, 5.95:1) |
| accent | `#0E8C99` | `#0A6B75` (`--v-accent-label`, 6.23:1) |

In the dark theme these label tokens **alias the base values** (`#3DDC84` / `#F0716B` / `#5FD8DE`) — the dark palette already clears 7:1, so nothing changes there. Never hardcode a hex for a small label; always use the token.

#### Threshold-crossing badge — theme-aware since TASK 9

The inline "▲ crossed +250%" / "▼ crossed −20%" pill sits on a **Position row**, which follows the theme canvas (white in light mode) — it is no longer on the old always-dark card surface. So it carries its own theme-aware pair:

| Token | Light (on white) | Dark (on `#0A0F1E`) |
| --- | --- | --- |
| `--v-badge-gain` | `#15794A` (5.43:1) | `#3DDC84` (10.70:1) |
| `--v-badge-loss` | `#B93030` (5.95:1) | `#FF8F85` (8.65:1) |

Both are 10px bold, so they are small text and must clear 4.5:1 — the earlier "bright in both themes" values measured **1.78:1** on a white row and were rejected. Rule of thumb: if a surface changes colour, every token tuned for the *old* surface colour must be re-audited.

#### Themed canvas applies to ALL tabs

The themed shell/content background is **not** tab-scoped. Light theme: canvas `#F5F7F4` on every tab (Insights, Holdings, Invest, Settings). Dark theme: canvas `#000814`. The earlier `[data-active-tab='insights']` / `'invest'`-scoped rules left Holdings and Settings on the legacy dark token `#0A0F1E`, which painted a black band behind the floating Ask Rufus pill in light mode. Never re-introduce per-tab canvas rules.

`--v-text-faint` is the low-emphasis tier. It is no longer allowed to fail AA: in the light theme it is `#6A7280` (4.50:1 on the canvas, 4.85:1 on white) and in the dark theme `#7C8AA0` (5.74:1). The earlier light value (`#8891A6`, 2.93:1) and dark value (`#5C6478`, 3.40:1) were both under the bar. The low end of the hierarchy is expressed with **size and weight**, not with illegible contrast. Faint is still the right choice for genuinely decorative marks (the `·` separators in the balance row, an inactive selection dot) — if a value is meant to be read, it belongs on secondary/tertiary.

### Dark theme

- Canvas background: `#000814`
- Card fill: `#0A0F1E` · Hero card fill: same `#0A0F1E` family (no separate dark-on-dark distinction needed — the canvas itself already signals dark theme)
- Border/hairline: `#141C2E`
- Text primary: `#EAEEF7` · Text secondary: `#C4CCDC` · Text tertiary: `#8891A6` · Text quaternary: `#5C6478`
- Accent: `#5FD8DE`
- Semantic gain: `#3DDC84` · Semantic loss: `#F0716B`
- View-only tag: text `#D9A94A` on background `rgba(217,169,74,0.1)`
- Brief section tags: MARKET `#5FD8DE` (accent) · PORTFOLIO `#3DDC84` (gain) · WATCH `#D9A94A` · EARNINGS `#A78BFA`
- Admin-restricted card: background `#161008`, border `#3A2E1C`, label `#D9A94A`

#### Derived dark surfaces (resolve from the palette above — do not invent new tokens)

The replaced dark-only palette listed a handful of *roles* that are intentionally no longer standalone tokens. When a component needs one, derive it from the dark palette above:

- **Secondary/nested panel** (was `#050A14`): use the canvas `#000814` as a nested surface inside a `#0A0F1E` card. In light mode the equivalent is `#F5F7F4` inside a `#FFFFFF` card.
- **Stronger border** (was `#2A3648`): no longer needed — on a near-black canvas the standard `#141C2E` hairline already separates surfaces. Do not add a second border weight.
- **Donut / chart track** (was `#1B2333`): use the border token (`#141C2E` dark, `#E7EAE4` light).
- **Faintest chart endpoint** (was `#4A5268`): use text-tertiary (`#8891A6`) in both themes; dark may use text-quaternary `#5C6478` for the very end of a line.
- **Text on accent fill** (was `#00272B`): use the canvas color as the on-accent text — `#000814` on dark accent `#5FD8DE`, `#FFFFFF` on light accent `#0E8C99`.
- **Hero cards are dark-navy islands in BOTH themes.** Their internal palette is therefore the *dark* semantic set in both modes — see the constant `--v-hero-*` tokens in `app/theme.css`. Never theme-flip colors inside a hero card.

### Shared across both themes (theme-independent)

- **Typography:** serif italic (existing Playfair) for headline numbers, screen titles, and the masthead wordmark. Sans/Inter for everything else.
- **Orb icon gradient:** radial, light-cyan to teal to deep-teal. Light theme uses `#9FF0F4` -> `#0E8C99` -> `#0A5A62`; dark theme uses `#9FF0F4` -> `#5FD8DE` -> `#1B7D82` (deeper stop in light theme for contrast against white surfaces).
- **Hero-stat glow:** soft radial glow behind the large stat number on a hero card ONLY (e.g. concentration-risk %) — `#5FD8DE` at ~15-18% opacity, feathered, no hard stops. This is the one approved exception to "no gradients" in both themes, scoped to this one element only.

### Ask Rufus bar (global, floating — not docked)

- Fixed position above the bottom nav, with margin on left/right/bottom (14px) so it visually floats rather than sitting flush — NOT full-width edge-to-edge.
- Rounded-full (24px radius).
- Light theme: white fill, box-shadow `0 6px 18px rgba(16,24,43,0.15)`.
- Dark theme: fill `#0F1626`, similar shadow at lower opacity for the dark canvas.
- Orb icon on the right, placeholder text "Ask Rufus anything..."
- Present on every tab, not scoped to one screen.

## Component patterns (final, reusable across all screens)

### Header pattern
One row only — connection status dot + account name (+ view-only tag if applicable) on the left, investor style as a plain text link (not a badge) on the right. `0.5px #141C2E` bottom border. No stacked pills, ever.

### Row-list pattern (holdings, orders, settings items)
No card backgrounds or borders around individual rows — separate with a single `0.5px #141C2E` top rule per row instead. Reserve bordered/filled cards (`#0A0F1E`) for standalone elements (notices, "Build Basket") only, not repeating list rows.

### Restricted/admin pattern
`#161008` background, `#3A2E1C` border, `#D9A94A` label text, physically separated from the surrounding list by margin, never inline in the same undifferentiated stack as regular items.

### Ask Rufus bar
Persistent and floating above the bottom nav on every tab (not scoped to one screen) — see "Ask Rufus bar (global, floating — not docked)" under **Theming** for current geometry and theme-dependent fill/shadow. Orb icon on the right, placeholder text "Ask Rufus anything...".

## AI Noticed card pattern (locked, applies wherever triggers can fire)

- Show exactly ONE card by default, even if multiple triggers are active.
- Priority order when multiple are active: Rebalance/concentration-risk > wash-sale (contextual, ticket-only) > event-impact > idle-cash / bounce-back. Reasoning: protecting what the user already has outranks surfacing new opportunity or informational content.
- Remaining active triggers collapse into a single "+N more insights" line, never stacked cards.
- Card structure: severity/category label -> one-line insight -> real CTA button (reuses ActionButton, never invented per-screen) -> optional dismiss.
- Metadata (cached/updated/refresh) limited to ONE small timestamp line, never more than 2 visible metadata elements total on a card.

## Content/tone rules (apply to all generated copy, not just AI Noticed)

- No urgency language: no "act now," no exclamation points, no implied time pressure, anywhere in the app — not just proactive triggers.
- Default framing is "no action needed" unless something genuinely warrants it.
- Never predict price direction or timing ("bouncing back," "about to run").
- No gamification: no streaks, badges-as-achievement, confetti, or progress bars framed as game mechanics.

## Data display rules

- Holdings rows show TOTAL gain (%+$), not TODAY's move, by default — Today's number is already visible at the portfolio-level header and repeating it per row reinforces short-term checking behavior; Total reinforces patience. Today's move lives one tap in, alongside fundamentals detail.
- Minimal by default, tap-through for depth — never show fundamentals-level detail (P/E, beta, analyst rating) inline on a summary row.

## What NOT to copy from reference apps

- Mercury's purple/cinematic-photography language — that's Mercury solving a different signaling problem (founder-facing, "not a traditional bank"). Borrow their precision standard only, not their visual identity.
- Any "Bold/energetic" direction explored earlier (confetti, neon, motion-as-hype) — explicitly rejected as wrong for this audience, reads as trading-as-entertainment (Robinhood-style), not discipline.

## Addendum — AI Noticed visual upgrade (Rebalance + idle-cash only) — Sep 2026

This pass upgrades the ONE-card AI Noticed treatment for Rebalance (concentration-risk) and idle-cash triggers ONLY. Wash-sale, event-impact, and bounce-back keep the current simpler card treatment until reviewed separately.

### Snooze control

- Replace the bare "Dismiss" button with a lightweight "Remind in Nd" text link (default N = 5 days).
- Tap opens a quick picker: 3 / 5 / 7 / 14 days.
- Selecting a duration suppresses re-firing for that many days — same `dismissed_until` mechanism as the existing snooze, just user-adjustable duration instead of fixed.

### Hero card (Rebalance + idle-cash)

- Orb icon + "RUFUS NOTICED" label above the insight text.
- Insight text rendered in the serif/italic voice font (same treatment as the balance number).

### Concentration-risk (Rebalance) card

- Donut chart showing actual portfolio composition from live holdings data, with the top 1-2 over-concentrated holdings in the accent/danger color and everything else in muted tones.
- CTAs (trade-enabled): "Trade" (primary — reuses existing Rebalance execution-ready-orders flow, still requires user approval before submission, no auto-execute) + "Download" (secondary text link), side by side.
- CTAs (read-only): "Download" only.

### Idle-cash card

- Two-bar illustrative chart: Cash (flat/muted) vs Invested (accent).
- HARD CONSTRAINT: NO percentages, NO index reference, NO timeframe. Static bars only.
- Caption must be prominent: "Illustrative only - not a projection or guarantee. Investing involves risk of loss."

### Not in this pass

- Do NOT "improve" the idle-cash chart later by adding real numbers/percentages/index/timeframe — the illustrative-only constraint is intentional and locked.
- Wash-sale, event-impact, bounce-back cards: unchanged.

## Addendum — Insights tab masthead + lead-stat glow (Sep 2026)

> **Naming note (PART 2):** this screen was previously called the **Today** tab. It is now the **Insights** tab (`TabId 'today' → 'insights'`), and it is the app's home screen. Everything in this addendum still applies; read "Today tab" as "Insights tab" throughout.

### Masthead (app-level brand, top of Insights tab)

- One row only: small orb icon (radial gradient `#9FF0F4 → #5FD8DE → #1B7D82`) + "Vantage" wordmark in serif italic at ~19px, top-left.
- Directly beneath the masthead row: a **2px `#5FD8DE` accent rule**. This is the ONE deliberate deviation from the standard `#141C2E` hairline — used nowhere else in the app.
- The account/status row (connection dot + account name + VIEW ONLY tag + investor-style link) sits BELOW the masthead + accent rule, unchanged. Its own bottom border remains the standard `0.5px #141C2E` hairline.
- Naming: "Vantage" is the app/brand name (masthead). "Rufus" is the AI persona only — it must never appear as an app-level brand/masthead label; it belongs exclusively on AI-attributed surfaces ("Ask Rufus" bar, "RUFUS NOTICED" labels, the chat identity).

### Radial glow exception (lead stat only)

- A subtle radial accent glow renders BEHIND the lead-story hero stat number only.
- Treatment: soft `radial-gradient` in the accent hue (`rgba(95,216,222,…)`) at low opacity (~0.16 peak), blurred, positioned behind the serif-italic number. The number itself stays fully opaque `#EAEEF7` on top.
- Constraint: subtle only — it must never overpower or obscure the number. This glow is a one-off exception for the hero stat and is NOT a general decorative rule (do not apply to balances, other stats, or labels).

### One-time streaming reveal (lead story)

- The first time a NEW lead-story trigger is shown, the supporting sentence types in character-by-character (~30-40ms/char). The hero stat and trend chart render instantly; only the sentence streams.
- "Seen" state persists (localStorage `vantage:seen-lead-triggers`, keyed by `triggerKey`) so an already-viewed trigger never re-plays — no looping/repeating animation, ever.

### Explainability chip (lead story)

- A small muted caption (`#5C6478`, 11px) beneath the supporting sentence, factual and data-derived (e.g. "3 of 26 positions concentrated"), never hardcoded generic copy.

## Addendum — Insights tab screen (PART 2) — Sep 2026

The Insights tab is the home screen. Top-to-bottom, nothing else may be inserted between these blocks:

1. **Masthead** — orb + "Vantage" serif-italic ~19px, account name right, one **2px** accent rule beneath.
2. **Header row** (single row) — connection dot + investor-style text link on one side, VIEW ONLY tag on the other.
3. **Hero deck** — swipeable, browse-only (see below).
4. **Portfolio Health card** — deterministic score + 3 sub-scores.
5. **Quick-links 2×2** — Rebalance plan · Risk reduction · Tax optimization · Goal tracker.
6. **Balance section** — "YOUR PORTFOLIO" label, serif-italic balance, Today/Total, "See Holdings →". No chart.
7. **Ask Rufus bar** — the global floating bar.

### Hero deck (Rufus Noticed)

- Card anatomy: orb + "RUFUS NOTICED" label, category label, large serif-italic stat with the approved glow, supporting sentence, chart/donut from real computed data, then an action row (primary CTA + secondary link + "Remind in Nd" snooze reusing the existing ActionButton/snooze logic).
- Card width `min(86vw, 320px)`; the next card peeks in. Native scroll-snap; dots track the active card.
- **Membership is deliberately narrow.** IN: `concentration_single`, `concentration_top3`, `event_impact` (**review** severity only), `idle_cash`, `bounce_back`, plus the Daily Brief / Weekly Snapshot teasers. OUT: `position_milestone`, `sentiment_shift`, `portfolio_drift`, `earnings_proximity`, `event_impact` (info), `wash_sale`. Milestones and info-tier events must never appear here — they belong to the secondary-notices pattern, which is not part of this screen.
- **Priority order:** concentration-single > concentration-top3 > event-impact(review) > idle-cash > bounce-back > Daily Brief > Weekly Snapshot.
- **Swipe is horizontal navigation ONLY.** A swipe must never trigger a dismiss, a snooze, or a CTA. Action handlers live exclusively on `<button onClick>`; the deck's pointer-drag writes only `scrollLeft` and swallows the trailing click after a >6px drag.
- **Fallback is reserved for the genuinely-empty case:** no eligible trigger **and** no Daily Brief / Weekly Snapshot teaser (e.g. a day-one account). Then, and only then, a single "no action needed" card renders with no deck and no dots. If teasers exist but no trigger is active, the teaser-only deck (with dots) is the correct render.

### Portfolio Health card

- **Deterministic** — same inputs always produce the same score; no model, no randomness. `overall = round(0.40×diversification + 0.35×riskBalance + 0.25×returns)`, computed from already-rounded sub-scores. Grades: ≥80 Strong · ≥60 Fair · else Needs attention. The formula is documented in `lib/insights/health-score.ts`.
- The supporting line must be data-derived and name a real holding with its real weight (e.g. "XLF is 30.3% of your holdings…") — never generic copy.
- "Ask Rufus to explain" opens the chat pre-filled with a prompt that references the **real** score and all three sub-scores.

### Quick-links 2×2

- **Rebalance plan** and **Risk reduction** deep-link into the active trigger flow when one exists; otherwise they fall back to an Ask Rufus prompt.
- **Tax optimization** and **Goal tracker** are always Ask Rufus — their subtitle reads "Ask Rufus" and the copy must never imply a feature that doesn't exist.
- No milestone notices strip and no trend chart on this screen.
