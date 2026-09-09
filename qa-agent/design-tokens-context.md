# Vantage Design Constitution

Reference context for any `/redesign` or `critique_design` call.

## Audience (why every rule below exists)

Ages 18-45. Don't have time or expertise to trade themselves. Explicitly NOT looking to gamble or chase a quick buck. Every design decision should reinforce patience and discipline, never urgency or checking-in behavior.

## Color Palette (final)

### Canvas
- Primary background: `#000814`
- Secondary panel (demoted sections, Ask Rufus bar strip): `#050A14`
- Card/bordered fill (secondary cards, notices): `#0A0F1E`
- Ask Rufus bar fill: `#0F1626`

### Borders/rules
- Standard hairline (row dividers, section rules): `#141C2E`
- Stronger border (bordered cards like "Build Basket"): `#2A3648`
- Donut chart track (unfilled): `#1B2333`
- Admin-restricted border: `#3A2E1C`

### Text
- Primary (headlines, key numbers, row titles): `#EAEEF7`
- Secondary (body copy, insight text): `#C4CCDC`
- Tertiary (muted labels, section headers like "PORTFOLIO VALUE"): `#8891A6`
- Quaternary (timestamps, chart axis labels): `#5C6478`
- Faintest (chart axis endpoints only): `#4A5268`

### Semantic (color reserved for data ONLY, never decorative)
- Gain/positive: `#3DDC84`
- Loss/negative: `#F0716B`
- View-only / restricted-amber: `#D9A94A`
- Admin-restricted background tint: `#161008`

### Accent (interactive/CTA only)
- Primary accent (Rufus orb, active tab, primary CTA fill, links): `#5FD8DE`
- Text-on-accent (button label color when background is `#5FD8DE`): `#00272B`

## Typography

- Display/headline (balance number, lead-story stat, position price, screen titles like "Holdings"): serif italic, `var(--font-voice)` equivalent — use the existing Playfair italic already in the codebase, do not introduce a new font.
- Body/UI (everything else — labels, row text, buttons): existing Inter/sans, unchanged.

## Component patterns (final, reusable across all screens)

### Header pattern
One row only — connection status dot + account name (+ view-only tag if applicable) on the left, investor style as a plain text link (not a badge) on the right. `0.5px #141C2E` bottom border. No stacked pills, ever.

### Row-list pattern (holdings, orders, settings items)
No card backgrounds or borders around individual rows — separate with a single `0.5px #141C2E` top rule per row instead. Reserve bordered/filled cards (`#0A0F1E`) for standalone elements (notices, "Build Basket") only, not repeating list rows.

### Restricted/admin pattern
`#161008` background, `#3A2E1C` border, `#D9A94A` label text, physically separated from the surrounding list by margin, never inline in the same undifferentiated stack as regular items.

### Ask Rufus bar
Persistent, `#0F1626` fill, 20px border-radius, sits above the bottom nav on every tab (not scoped to one screen) — orb icon on the right, placeholder text "Ask Rufus anything..." at `#5C6478`.

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

## Addendum — Today tab masthead + lead-stat glow (Sep 2026)

### Masthead (app-level brand, top of Today tab)

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
