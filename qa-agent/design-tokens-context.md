# Vantage Design Constitution

Reference context for any `/redesign` or `critique_design` call.

## Audience (why every rule below exists)

Ages 18-45. Don't have time or expertise to trade themselves. Explicitly NOT looking to gamble or chase a quick buck. Every design decision should reinforce patience and discipline, never urgency or checking-in behavior.

## Visual language: Copilot-inspired restraint

- Background: deep navy canvas (`#000814`), not pure black or lighter navy.
- Color is reserved for data only — gains/losses, active state. Never decorative.
- Gain/positive: `#3DDC84` · Loss/negative: `#F0716B` · Interactive/CTA: `#5FD8DE`
- Typography: Playfair italic for large headline numbers (balance, big figures). Inter/sans for everything else — labels, body, rows.
- No gradients, no drop shadows, no decorative badges/chips stacked together.
- Precision standard (borrowed from Mercury, not their color language): spacing and type weight should be deliberate, not "close enough" defaults.

## Header pattern (locked, applies to every screen)

One slim row: connection status + account name + view-only tag if applicable, inline. Investor style is a tappable link, never a badge. No more than this one row of chrome above the screen's actual content.

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
