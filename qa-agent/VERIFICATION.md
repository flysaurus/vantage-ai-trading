# Insights tab — verification

Harness: `qa-agent/verify-insights.cjs` (Playwright, mobile 430×932 + desktop 1440).
Run: `npx next dev -p 3002` then `node qa-agent/verify-insights.cjs` from the repo root.

Screenshots: `/tmp/vantage-shots/insights/*.png` · results: `/tmp/vantage-shots/insights/results.json`

All network calls are route-mocked (canned accounts / broker / noticed / briefs). **No production data is written**; the only POSTs that reach a handler are the ones the test deliberately triggers, and those are mocked too.

## Result

**62 / 62 checks pass.**

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

## Interpretation notes / open questions

- **Fallback semantics.** "Fallback = single 'no action needed' card, no
  deck/dots" is implemented as *deck is completely empty*. Daily Brief /
  Weekly Snapshot teasers are deck cards "when content exists", so a user with
  no actionable trigger but a brief today sees a 1–2 card teaser deck, not the
  fallback (scenario D2). If the intent is "no *trigger* → fallback, teasers
  suppressed", that's a one-line change in `buildDeck()`.
- **Dev-only nextjs-portal overlay** is hidden by the harness; it is not part of
  the app.
- Mock portfolio has `dayChange=0` / `totalPnl=0`, so the balance section reads
  `Today $0.00 (+0.0%)` in the screenshots — mock data, not a rendering bug.
