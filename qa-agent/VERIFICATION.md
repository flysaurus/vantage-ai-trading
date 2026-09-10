# Insights tab — verification

Harness: `qa-agent/verify-insights.cjs` (Playwright, mobile 430×932 + desktop 1440).
Run: `npx next dev -p 3002` then `node qa-agent/verify-insights.cjs` from the repo root.

Screenshots: `/tmp/vantage-shots/insights/*.png` · results: `/tmp/vantage-shots/insights/results.json`

All network calls are route-mocked (canned accounts / broker / noticed / briefs). **No production data is written**; the only POSTs that reach a handler are the ones the test deliberately triggers, and those are mocked too.

## Result

**65 / 65 checks pass.**

## Scenarios

| # | Scenario | Key assertions |
|---|----------|----------------|
| A | Light, full access, active triggers | masthead orb + serif-italic "Vantage" + account name + 2px accent rule; header row (connection dot + investor style / VIEW ONLY absent); hero deck present, 6 cards, 6 dots; concentration card first; `position_milestone` not rendered; `event_impact` info-tier not in deck; bottom nav = Insights/Holdings/Invest/Settings with Insights active; Ask Rufus bar present |
| B | Dark parity | `data-theme=dark`, canvas `rgb(0,8,20)`, identical structure |
| C | Read-only account | VIEW ONLY tag; trigger CTAs are `Download` / `Review NVDA` (drill-ins), **no** Trade / Invest / Buy / Sell anywhere |
| D | No triggers, no brief content | single fallback card, `hero-deck` absent, `deck-dot` absent, copy says "No action needed" |
| D2 | No triggers, brief content exists | teaser-only deck (2 cards) — see the interpretation note below |
| E | Swipe = navigation only | drag 3× → `data-active-index` 0→3, `scrollLeft=871`; **0** chat POSTs; **0** dismiss POSTs; tap on card body does nothing; active dot tracks the card; an *explicit* tap on "Remind in 5d" opens the snooze sheet and the deliberate choice **does** POST to `/api/ai/noticed/dismiss` |
| F | Portfolio Health | score 43 = `round(0.40×3 + 0.35×83 + 0.25×50)` verified in-browser; all three sub-scores present; supporting line names a real holding ("XLF is 30.3% of your holdings…"); "Ask Rufus to explain" opens chat and the pre-filled prompt carries the real score + all three sub-scores |
| G | Quick links 2×2 | rebalance → active drift alert (`data-branch="trigger"`); risk reduction → active concentration alert + focuses the symbol; tax + goals → Ask Rufus only, subtitle "Ask Rufus", no feature-implying copy |
| H | Theme toggle (Preferences) | Light / Dark / System present; switching applies live with **0 navigations**; choice persists to `vantage:theme`; System resolves to the emulated OS appearance (dark → light) and also needs no reload |
| I | Desktop parity | left sidebar with the same four tabs, no bottom nav |
| J | Stale deep link | `?tab=today` (pre-rename id) resolves to the Insights tab, renders the masthead + deck instead of a blank content area, and the URL is cleaned up |

## Bugs found and fixed while verifying

1. **Pre-filled chat prompt was swallowed (real bug, fixed).**
   `components/ai/AITab.tsx` consumed `pendingPrompt` in a mount effect and
   returned `clearTimeout` as cleanup. React 18 StrictMode mounts effects twice
   in dev: the simulated unmount cleared the timer *after* the flag had already
   been set to `null`, so the prompt never sent. Removed the cleanup; the
   remount reads `null` and is a no-op. This affected the pre-existing
   bell → chat flow too.
2. **Dark canvas never applied (fixed).** `app/theme.css` had a
   `body:has(.app-shell[data-active-tab='insights'])` override for light only,
   so dark kept the legacy `#0A0F1E` shell instead of the spec canvas `#000814`.
   Added the matching dark rules (shell, `.bg-app`, body).
3. **First-login Account Select overlay covered the screen (test-only).**
   `MainApp` renders it as a full-screen overlay on top of the app shell unless
   `vantage:skipAccountSelect:v2` is set, so early screenshots showed the
   account picker and every synthesized pointer event was intercepted. The
   harness now sets that flag.
4. **Stale `?tab=today` links rendered a blank shell (real bug, fixed).**
   `MainApp`'s two navigation allowlists still accepted the pre-rename `'today'`
   id, but `TAB_COMPONENTS` has no such entry, so `?tab=today` (or an old
   custom nav event) set an unknown tab and rendered nothing. Both sites now go
   through `resolveTab()`, which maps `today → insights` and rejects anything
   unknown. Covered by scenario J.

## Interpretation notes / open questions

- **Fallback semantics — CONFIRMED with Em (2026-09-10).** "Fallback = single
  'no action needed' card, no deck/dots" applies **only to the genuinely-empty
  case**: no eligible trigger AND no Daily Brief / Weekly Snapshot teaser (e.g.
  a day-one account with nothing generated yet). If teasers exist but no real
  trigger is active, the **teaser-only deck with dots** is the correct
  behaviour, not a bug (scenario D2). Locked by tests in
  `tests/insights-deck.test.ts`; a teaser with a blank headline does not count
  as content, so an empty brief cannot fake a non-empty deck.
- **Dev-only nextjs-portal overlay** is hidden by the harness; it is not part of
  the app.
- Mock portfolio has `dayChange=0` / `totalPnl=0`, so the balance section reads
  `Today $0.00 (+0.0%)` in the screenshots — mock data, not a rendering bug.

---

# PART 2b addendum — polish fixes (nine additive changes)

Harness: `qa-agent/verify-insights-polish.cjs` (same route-mock mechanism as
`verify-insights.cjs`; nothing touches production). Screenshots land in
`/tmp/vantage-shots/insights-polish/`. **46/46 checks pass.** The original
A–J suite still passes **65/65** unchanged, i.e. the polish work introduced no
regressions.

| Fix | Check | What is asserted |
| --- | --- | --- |
| 1 | P1a–P1h | Read-only Fidelity account: one badge, broker name `FIDELITY` (10.5px/800, primary text colour) stacked over `view only` (8.5px, muted), single amber tint behind both — light **and** dark |
| 2 | P2a–P2e | DOM order masthead → balance → hero deck → Portfolio Health → quick-links; balance number still serif-italic |
| 3 | P3a–P3f | `hero-stat` = Inter 800 / normal (not serif, not italic); `card-sentence`, `card-caption` sans; wordmark still Playfair italic |
| 4 | P4a–P4c | Real CDP touch events: vertical swipe **on a card** scrolls the page (scrollTop 261 → 537) and does **not** change the active card; horizontal swipe still navigates (scrollLeft 0 → 247, index 0 → 1) |
| 5 | P5a–P5c | All six "Ask Rufus" links: `text-decoration: none`, accent colour, trailing `→`. Deck cards use `--v-hero-accent` (#5FD8DE, dark-navy island), Health + quick-links use `--v-accent` (#0E8C99 light / #5FD8DE dark) |
| 6 | P6a–P6b | `quick-link-risk-ask` renders `Ask Rufus →` **and** the tile still deep-links (`data-branch="trigger"`) |
| 7 | P7a–P7f | Bar is 54px tall, `1px solid` accent border, shadow kept, placeholder `Ask about your portfolio...`, placeholder colour darkened (`#56606f` light / `#9aa6bc` dark) |
| 8 | P7d | Placeholder copy appears on the bar; the expanded chat input's `PLACEHOLDERS` pool already led with the same string |

## Fix-4 root cause (the gesture bug)

`HeroDeck`'s `<style>` block declared `touch-action: pan-x` on `.hero-deck`.
That does **not** mean "horizontal swipes are mine, everything else is yours" —
it *forbids the browser from panning vertically at all* for any touch that
starts inside the deck, so a vertical drag on a card was simply swallowed and
the page never scrolled. Changed to `touch-action: pan-x pan-y`: the browser
picks the dominant axis, and a vertical gesture chains out of the deck
(`overflow-y: hidden`) to the nearest scrollable ancestor.

## Fix-6 root cause (the missing link)

Each quick-link tile rendered a single `sub` line whose value became
`Uses your active concentration alert` on the trigger branch — so the
"Ask Rufus" text never rendered for that tile. Every tile now always renders
its own `quick-link-<id>-ask` line; the "uses your active alert" copy is
additive honesty on the deep-link branch, never a replacement.

## Interpretation notes

- Two things the vision pass flagged are **expected, not defects**: the floating
  Ask Rufus bar overlaps whatever content scrolled beneath it (it is a
  `position: fixed` overlay), and the gap between the last card and the bottom
  nav is `.content-area`'s 156px bottom padding, reserved so the floating bar
  never covers tappable content.
- The deck's "Ask Rufus" link is deliberately `--v-hero-accent` (#5FD8DE) rather
  than `--v-accent`: hero cards are dark-navy islands in **both** themes, so the
  light-theme teal would be unreadable there. Same treatment (accent + `→` + no
  underline), surface-appropriate token.

---

# PART A + PART B — brief modal & chat overhaul

Harness: `qa-agent/verify-brief-chat.cjs` (Playwright, mobile 430×932).
Run: `npx next dev -p 3002` then `node qa-agent/verify-brief-chat.cjs` from the repo root.

Screenshots: `/tmp/vantage-shots/brief-chat/*.png` · results: `/tmp/vantage-shots/brief-chat/results.json`

## Result

**41 / 41 checks pass** — and no regressions: `verify-insights.cjs` 65/65,
`verify-insights-polish.cjs` 46/46, `npx vitest run tests/insights-*.test.ts` 22/22.

## PART A — brief routing, modal, chat bridge

| # | Scenario | Key assertions |
|---|----------|----------------|
| A1 | Tap the Daily Brief teaser | exactly one `brief-modal` opens; **no** tab switch, **no** chat |
| A2 | Modal identity | `data-brief-kind="daily"`, title "Today's Daily Brief" |
| A3–A5 | Real content | all four sections (`MARKET` / `PORTFOLIO` / `WATCH` / `EARNINGS`) present with the actual brief text, not placeholders |
| A6/A7 | Insights underneath | `nav-insights[data-active=true]`, `nav-portfolio[data-active!=true]` — never navigates to Holdings |
| A8–A10 | Dismissal | close button, `Escape`, and backdrop click each dismiss and leave Insights rendered |
| A11–A13 | Weekly Snapshot teaser | same modal, `data-brief-kind="weekly"`, snapshot body + `Health 7/10 · Risk MODERATE` subtitle |
| A14–A17 | "Ask Rufus about this" | modal closes, chat opens, the brief text is both **visible in the user bubble** and present in the `/api/chat` request payload (grounded follow-ups) |

The bug behind A1: `openTeaser()` previously called `setTab('portfolio')`, so a
brief tap dumped the user on Holdings. It now only opens the modal.

## PART B — chat window overhaul

| # | Scenario | Key assertions |
|---|----------|----------------|
| B1 | No mode picker | zero `Deep Dive` buttons, zero `aria-pressed` elements in the chat chrome — every send goes out as `mode: 'chat'` |
| B2 | No persistent counter | no `N messages left` text anywhere with 40 remaining; `chat-low-limit-warning` absent |
| B3 | Warning only when close | threshold = `min(5, 10% of daily limit)`: limit 50 → 6 silent / 5 warn (`⚠️ 5 messages left today`) / 2 warn; limit 20 → threshold 2 → 3 left silent |
| B4 | Go deeper | POST goes out with `mode: 'deep'`, re-asks the **original** question, the answer is replaced **in place** with the longer deep-research text, `go-deeper` count stays 1 (no extra bubble), response tagged `DEEP RESEARCH` |
| B5 | Collapse routing | closing from Insights → Insights; closing from Holdings → **Holdings**, not Insights |

Failure paths (in `AITab.tsx`) restore the original answer verbatim rather than
appending a half-answer: validation-reject and stream-error both drop the deep
result, keep the original text, and toast that the original is unchanged.

---

# Concentration-risk card — two-column layout

Harness: `qa-agent/verify-concentration-layout.cjs` (Playwright; 430×932, 360×780, 320×700 + 320×700 short).
Run: `node qa-agent/mint-session.cjs` (fresh Supabase session), then
`npx next dev -p 3002`, then `node qa-agent/verify-concentration-layout.cjs` from the repo root.

Screenshots: `/tmp/vantage-shots/concentration-layout/*.png` · results: `/tmp/vantage-shots/concentration-layout/results.json`

## Result

**47 / 47 checks pass** — no regressions: `verify-insights.cjs` 65/65,
`verify-insights-polish.cjs` 46/46, `verify-brief-chat.cjs` 41/41,
`npx vitest run tests/insights-*.test.ts` 22/22, `npx tsc --noEmit` unchanged
(only the pre-existing `tests/etf-sectors.test.ts` error).

## What changed

`components/insights/InsightCard.tsx` only — and only for
`concentration_single` / `concentration_top3`:

* `donutSlices(positions, topN)` now owns the weight math (unchanged formula:
  `marketValue / Σ marketValue`), and both donut variants share one `DonutRing`.
* `HoldingsDonut` (ring + legend beside) is untouched — still used by non-concentration cards.
* New `HoldingsDonutColumn` — compact ring with the legend stacked **beneath** it,
  `topN = 2` so it is always top-2 + an `Other` bucket (max 3 lines, never every position).
* Body becomes `concentration-two-col`: left `flex: 1.2` (label → stat → sentence → sub-line),
  right `flex: 0 0 108px` (donut rail). `CardHeader` stays full-width above and the
  action row stays full-width below; the stat drops 34px → 30px in this card only.
* No trigger logic touched (`lib/noticed/*`, `lib/concentration.ts` untouched).

## Checks

| # | Scenario | Key assertions |
|---|----------|----------------|
| C1–C5 | Structure | two-column split exists; header sits above both columns and spans their full width; action row sits below both and spans their full width |
| C6–C9 | Geometry | right rail exactly 108px; left column wider; side-by-side; top-aligned; 14px gutter |
| C10–C15 | Left column | measured top-to-bottom order label → stat → sentence → sub-line; label reads `CONCENTRATION`; stat `30.3%` = the **real** XLF share; stat 30px/800/normal-weight/non-serif; sub-line "XLF is your largest holding"; sentence present |
| C16–C23 | Right column (real data) | legend is exactly `XLF 30% / XLP 20% / Other 50%` — the real top-2 by market value + an `Other` bucket, with the 3rd-largest position (XLV) never listed; the donut arcs measure 30.26% / 19.93%, matching the fixture to ±0.5pt; arc count == legend count |
| C24–C25 | Scope guard | no other trigger type (`event_impact`, `idle_cash`, `bounce_back`) gained the split or the stacked donut; they keep the 34px stat |
| C26–C31 | Swipe/dots | a drag **starting on the new donut rail** still advances the deck (0 → 1) and fires **no** chat POST, **no** dismiss/snooze POST, no chat overlay, no snooze sheet; the active dot tracks the card |
| C32–C33 | Action row | primary CTA still present after the relayout; "Ask Rufus" link keeps the fixed accent colour + `text-decoration: none` |
| C35–C42 | Narrow (320px) | split still renders; **zero** elements overflow the card box; no page-level horizontal scroll; rail still 108px; left column still 140px; stat still 30px; legend still 3 lines, unclipped; action row still below the columns |
| C43 | Narrow (360px) | no card overflow, no page-level horizontal scroll |
| C44–C47 | Usability at 320×700 | the CTA is genuinely hit-testable at its centre (`elementFromPoint` → the button, 0px covered by the floating Ask Rufus bar); gutter is the deliberate 14px; legend percentages stay inside the card's padding box |

### Note on the "covered CTA" false alarm

An element-level screenshot at 320×700 shows the floating Ask Rufus bar over the
card because Playwright scrolls the element only minimally. C44 proves the CTA is
fully hittable once the card is scrolled into view; the bar belongs to the
app shell, not the card.

### Note on the rounded legend

The legend shows `30%` where the sentence says `30.3%` — deliberate: the whole
percentages are what fit a 108px rail, and the exact figure is one line above.

## Gotcha (cost 20 minutes)

The live-data harnesses build a Supabase session from `/tmp/vantage-session.json`,
whose access token expires after **1 hour**. When it lapses the app renders the
logged-out landing page ("I have an account / Every investor has a style") and the
harness fails with "hero-deck missing" — which looks like an app break and is not.
Always run `node qa-agent/mint-session.cjs` before these harnesses. `gotoInsights()`
now retries once and prints the body text so this is obvious next time.

## Follow-on fix: CI test drift (run 34484132436)

The live suite still asserted the **persistent** "N messages left" counter that
PART B removed by design, so `functional.spec.ts:489` failed. Rewritten as
`no persistent message counter — limits surface only near the cap`:

* a bare counter must never render (`\d+\s*(analyses|messages)\s*(left|remaining)`);
* the low-limit pill is derived from the account's **real** `/api/usage/remaining`
  + `/api/usage/stats` and asserted against `min(5, 10% of daily limit)` exactly
  (skipped, with a warning, when the endpoints are unauthenticated).

No app code changed for this — the behaviour was intentional; the test was stale.
