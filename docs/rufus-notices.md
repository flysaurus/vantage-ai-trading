# Rufus Noticed — trigger reference

Canonical reference for every **Rufus Noticed** notification and the exact conditions
under which it fires. If you change a trigger, a threshold, or a band, update this file.

Nine trigger types are actually emitted today:

| # | Trigger | Fires from | Primary surface |
|---|---|---|---|
| 1 | `idle_cash` | `lib/noticed/idle-cash.ts`, `lib/noticed/engine.ts` | Deck · Digest |
| 2 | `position_milestone` | `lib/noticed/engine.ts` | Inline badge · Digest |
| 3 | `portfolio_drift` | `lib/noticed/engine.ts` | Digest |
| 4 | `concentration_single` | `lib/noticed/engine.ts` | Deck |
| 5 | `concentration_top3` | `lib/noticed/engine.ts` | Deck |
| 6 | `earnings_proximity` | `lib/noticed/engine.ts` | Digest |
| 7 | `sentiment_shift` | `lib/noticed/engine.ts` | Digest |
| 8 | `event_impact` | `lib/noticed/event-impact.ts` | Deck · More from Rufus |
| 9 | `bounce_back` | `lib/noticed/bounce-back.ts` | Deck |

---

## 0 · Where a notice can appear (four surfaces)

| Surface | Component | What reaches it |
|---|---|---|
| **Hero deck** | `components/insights/HeroDeck.tsx` + `lib/insights/deck.ts` | `isDeckEligible()` — `concentration_single`, `concentration_top3`, `event_impact` (**review tier only**), `idle_cash`, `bounce_back`, plus Daily-Brief / Weekly-Snapshot teasers |
| **More from Rufus** | `components/insights/MoreFromRufus.tsx` + `lib/insights/noticed-copy.ts` | `isMoreFromRufusEligible()` — **`event_impact` only**, both tiers (review gets a "Review" link; info is informational with no link) |
| **Inline badge** | `lib/insights/threshold-badge.ts` | `position_milestone` only — a badge on the position's Holdings row, never a card |
| **Daily email digest** | `lib/digest.ts` | 5 labelled types: 💵 Cash Alert, 📊 Position Milestone, ⚖️ Portfolio Drift, 📅 Earnings Ahead, 📰 Sentiment Shift |

**Hero deck order** (`DECK_PRIORITY`, lower sorts first):

```
concentration_single 0 → concentration_top3 1 → event_impact 2 → idle_cash 3
→ bounce_back 4 → Daily Brief 5 → Weekly Snapshot 6
```

Tiebreak inside a band = newest first, then id. `position_milestone`, `sentiment_shift`,
`portfolio_drift` and `earnings_proximity` are deliberately **out of the deck**;
milestones are out of every list card (badge-only).

---

## 1 · `idle_cash` — 💵 `INVEST_CASH`

**Fires when all four hold:**

1. `availableCash` is known (not `null`) — cash the broker did not report stays *unknown*, never estimated;
2. `availableCash > $500` (`IDLE_CASH_THRESHOLD`);
3. `idleCashStreak >= 3` **consecutive trading days** (`IDLE_CASH_MIN_DAYS`);
4. account is **not** read-only (demo is always tradable; a live broker is read-only iff `trading_enabled === false`).

- `availableCash` = settled cash **− open reservations** (orders in `open`/`pending`/`submitted`/`partially_filled`).
- Streak lives in `daily_cash_snapshots` (one row per user+account+ET day, idempotent upsert). Walks backwards skipping weekends; **a missing snapshot or a below-$500 day breaks it**. Max lookback **120 days**.
- Key `idle_cash` · title `$X cash idle` · variant `warn` · icon 💤 · action `INVEST_CASH:<amount>` · deck **P3**.
- Needs ≥3 days of snapshot history, so a brand-new account cannot fire it.
- Replaced the old `cashPct > 50 && daysSinceLastTrade > 7` heuristic — the threshold is a **dollar amount, not a %**.

Source: `lib/noticed/idle-cash.ts` → `IDLE_CASH_THRESHOLD`, `IDLE_CASH_MIN_DAYS`, `resolveIdleCash`; `lib/noticed/engine.ts` → `idle_cash` block.

---

## 2 · `position_milestone` — 📈/📉 *(badge only)*

**Fires when a holding's total P&L % crosses a band.** Only the **single most-extreme** band crossed per position is surfaced.

- Default ladder (from `lib/noticed/bands.ts`): gains `POSITIVE_BANDS = [15, 25, 50, 100, 250]`, losses `NEGATIVE_BANDS = [-10, -20, -35, -50]`, with **±1pp tolerance** (`BAND_TOLERANCE_PCT = 1`) — e.g. AMD at +249.14% badges **+250%**, not +100%.
- User overrides: `target_return_pct` fires at **exactly** that gain and `target_loss_pct` at **exactly** that loss — **no tolerance** (a user's own number is a promise).
- Key `MILESTONE_<SYM>_+25` / `MILESTONE_<SYM>_-20` · CTA `REVIEW_POSITION:<SYM>` · variant `gain` (📈) / `warn` (📉).
- The same ladder drives the inline badge (`lib/insights/threshold-badge.ts` imports `crossedBand`), so badge and engine can never drift.
- **Never a card** in the deck or in More from Rufus.

Source: `lib/noticed/bands.ts` → `POSITIVE_BANDS`, `NEGATIVE_BANDS`, `BAND_TOLERANCE_PCT`, `crossedBand`; `lib/noticed/engine.ts` → milestone block; `lib/insights/threshold-badge.ts` → badge rendering.

---

## 3 · `portfolio_drift` — ⚖️ `REBALANCE`

**Fires per sector when `|current% − style target%| >= 15` percentage points.**

- Requires `investor_style` to be set **and** have `STYLE_SECTOR_TARGETS` — no style ⇒ **zero drift notices, ever**.
- Requires account **cash known**; cash `null` ⇒ the rule is skipped outright rather than computed off a guessed denominator.
- Denominator = Σ(position market value) **+ cash** (deliberately *not* `equity`, which already includes cash client-side).
- Broad-market ETFs are decomposed into their underlying sectors first (dynamic Yahoo weights → cached, else static profile).
- `NON_SECTOR_BUCKETS` (`Broad Market`, `Cash`, `Fixed Income`, `International`) are skipped.
- Variant `warn` if deviation **> 25pp** else `accent` · key `DRIFT_<SECTOR>` (non-alphanumerics → `_`) · sorted by |deviation| desc, **top 5** · icon ⚖️.

Source: `lib/noticed/engine.ts` → `findDriftTriggers`; `lib/sector-targets.ts` → `STYLE_SECTOR_TARGETS`, `NON_SECTOR_BUCKETS`.

---

## 4 · `concentration_single` — 🎯 `REVIEW_POSITION`

**Fires when the largest holding is `> conc_single_pct` % of the *invested* portfolio.**

- Denominator is **invested value only** — cash is excluded on purpose (this is about holding concentration, not allocation).
- Effective threshold: user's `conc_single_pct` → style suggestion → global default **20** (`DEFAULT_CONC_SINGLE_PCT`). Style suggestions (`STYLE_CONC_DEFAULTS`): buffett/munger/soros **30**, livermore **20**, lynch **12**.
- Title `<SYM> is X% of you` · variant `accent`, `warn` if **> 35%** · key `CONC_SINGLE_<SYM>` · deck **P0** · icon 🎯.

Source: `lib/noticed/engine.ts` → concentration block; `lib/concentration.ts` → `DEFAULT_CONC_SINGLE_PCT`, `STYLE_CONC_DEFAULTS`, `resolveConcentrationThresholds`.

---

## 5 · `concentration_top3` — 🧺 `BUILD_BASKET`

**Fires when the top 3 holdings are `> conc_top3_pct` % of invested value.**

- Effective threshold: user's `conc_top3_pct` → style → default **50** (`DEFAULT_CONC_TOP3_PCT`) (buffett/munger/soros 65, livermore 50, lynch 40).
- Title `Top 3 are X% of you` · variant `accent`, `warn` if **> 70%** · key `CONC_TOP3` · deck **P1** · icon 🧺.
- CTA opens the **basket-build** flow, not the rebalance wizard.

Source: `lib/noticed/engine.ts` → concentration block; `lib/concentration.ts` → `DEFAULT_CONC_TOP3_PCT`.

---

## 6 · `earnings_proximity` — 📅 *(needs `FINNHUB_API_KEY`)*

**Fires when a held or watchlisted symbol has an earnings date within the next 30 days.**

- Symbols = positions ∪ watchlist; window = today → +30 days (Finnhub `calendar/earnings`); takes the nearest date.
- Key `EARNINGS_<SYM>_<date>` · **no CTA** (no `meta.action`) · variant `accent` · icon 📅.
- Not in the deck, not in More from Rufus — **digest only**.
- Returns `[]` with no error surfaced when `FINNHUB_API_KEY` is absent.

Source: `lib/noticed/engine.ts` → `findEarningsTriggers`.

---

## 7 · `sentiment_shift` — 📰 `REVIEW_POSITION` *(needs Finnhub + local FinBERT)*

**Fires when ≥2 of a symbol's recent headlines score negative.**

- Symbols: first **10** of positions ∪ watchlist. News window: **last 3 days**.
- Needs ≥2 headlines (takes up to **5**), each POSTed to FinBERT (`FINBERT_URL`, default `http://127.0.0.1:8765/analyze`).
- Fires when **≥2 headlines** have `label === 'negative' && score > 0.5`.
- Key `SENTIMENT_<SYM>` · variant `warn` · icon 📰 · CTA `REVIEW_POSITION:<SYM>`.
- If the FinBERT service is down this silently produces nothing.

Source: `lib/noticed/engine.ts` → `findSentimentShiftTriggers`.

---

## 8 · `event_impact` — ⚖️/📊/🏛️/🔬 *(needs Finnhub)*

**Fires when a genuinely material event is detected on a holding.** Two tiers.

- Scope: **top 10 holdings by market value**. Lookback **3 days**. Fund/ETF names are skipped (no company-level events).
- A headline must pass all three:
  1. **about the holding** — contains the ticker as a whole word, or the company-name root (suffixes like *Inc/Corp/Class* stripped, root ≥3 chars);
  2. **not noise** — rejected if it ends in `?` or matches clickbait markers ("is a buy", "here's why", "preview", "what to know"…);
  3. **classifies** into a category.
- `REVIEW_TERMS` → severity **review** (lawsuit, investigation, antitrust, recall, data breach, earnings miss, guidance cut, acquisition, bankruptcy, delisting, dividend cut, CEO resigns, FDA rejects, trial fails…). `INFO_TERMS` → severity **info** (earnings beat, raises guidance, buyback, dividend increase, new CEO, FDA approval, contract win…). Rumor markers ("in talks", "reportedly", "may acquire") **reject** corporate-action items.
- At most **one trigger per symbol per day** (the single most-severe event).
- Key `EVENT_<SYM>_<YYYY-MM-DD>`.
  - **review** → title `<SYM> — <category> event`, variant `warn`, CTA `REVIEW_POSITION:<SYM>` → deck (**P2**) **and** More from Rufus (with Review link).
  - **info** → title `<SYM> — <category> update`, variant `accent`, **no action** → More from Rufus only (informational, no link).

Source: `lib/noticed/event-impact.ts` → `findEventImpactTriggers`, `REVIEW_TERMS`, `INFO_TERMS`, `LOOKBACK_DAYS = 3`, `MAX_SYMBOLS = 10`.

---

## 9 · `bounce_back` — 🔎 `REVIEW_POSITION`

**Fires when a quality holding is temporarily discounted — a 4-filter conjunction (all must pass).**

- Scope: top **10** holdings, excluding Broad Market / Fixed Income / International / Commodities.
- **(a) Fundamentals intact** — TTM revenue present and not declining; a latest-earnings **miss disqualifies**.
- **(b) Broad decline, not company-specific** — 90-day return ≤ **−10%** (`DECLINE_WINDOW_DAYS = 90`, `MIN_DECLINE_PCT = 10`); the benchmark (sector ETF via `SECTOR_ETF`, SPY fallback) is **also** down; and the ticker isn't trailing the benchmark by more than **10pp** (`MAX_UNDERPERFORM_PP = 10`).
- **(c) Below its own history** — current P/E ≥ **20%** below its own **2–4yr** average (`DISCOUNT_THRESHOLD = 0.2`, P/B fallback), from Yahoo annual diluted EPS / book value vs month-end prices, needs **≥2** annual points (`MIN_YEARS = 2`).
- **(d) No open review-tier event** on the same symbol this pass.
- Frequency: **one per user per week, system-wide** — the single most-discounted candidate; already-fired symbols are permanently excluded, so it walks down the list week by week. Active cards are kept alive so they aren't stale-resolved.
- Key `BOUNCE_<SYM>` · variant `accent` · deck **P4** · icon 🔎 · closing copy must be "Worth reviewing the position yourself."

Source: `lib/noticed/bounce-back.ts` → `findBounceBackTriggers` and the `DECLINE_WINDOW_DAYS` / `MIN_DECLINE_PCT` / `MAX_UNDERPERFORM_PP` / `DISCOUNT_THRESHOLD` / `MIN_YEARS` / `MAX_SYMBOLS` constants.

---

## 10 · Lifecycle (applies to every trigger)

- **Dedupe** — `noticed_items` is unique on `(user_id, account_id, trigger_key)`; writes are upserts.
- **New vs re-fired** — `trulyNew` = fires now ∧ not currently active ∧ not a resolved item being re-activated this pass.
- **Reactivation** — a resolved key that fires again is flipped back to `resolved = false`, `dismissed_until = null`, `regenerated_count++`, fields refreshed, and re-queued for a fresh generation pass (so its body can't stay stale).
- **Stale resolve** — every active item whose key is **not** in the full current firing set is resolved. **Guard:** the whole pass is skipped when the position list is empty (a degraded read must never wipe the feed — this is what produced the "nothing under Rufus Noticed" bug on the 349-position account).
- **Snooze** — a future `dismissed_until` hides the item *and* shields it from the stale-resolve pass.
- **Feed** — `GET/POST /api/ai/noticed` returns up to **50** unresolved, un-snoozed rows for the account scope, newest first (`NOTICED_FEED_LIMIT = 50` — a safety cap, not a materiality filter).
- **Copy** — batch AI generation (`maxTokens` 400, temp 0.4) with a strict tone prompt; budget-gated per user; on budget exhaustion or failure it falls back to a deterministic humanized one-liner and **never** leaks the raw machine context.
- **Cadence** — client-triggered `POST /api/ai/noticed`, plus `POST /api/cron/portfolio-agent` (QStash, multi-user batched).

Source: `lib/noticed/engine.ts` → `runNoticedEngine` / resolution pass; `app/api/ai/noticed/route.ts` → `NOTICED_FEED_LIMIT`.

---

## 11 · Reserved / dead code

- **`wash_sale` is dead** — named in the deck exclusion list (`lib/insights/deck.ts`) and handled in `lib/insights/format.ts` (label `WASH SALE`), but **nothing emits it**. Reserved for a future wash-sale trigger; keep it out of the deck until an emitter exists.

---

## 12 · What is *not* covered (honest gaps)

- **`wash_sale` is dead** — see §11.
- **Drift needs a style + targets** — no investor style ⇒ no drift notices at all.
- **Idle cash needs history** — cannot fire on day 1 (needs ≥3 days of snapshots).
- **News engines are top-10 only** — positions ranked 11th and below never produce `event_impact`, `sentiment_shift` or `bounce_back` (holdings like the 300+ tail of a 349-position account are invisible to them). `earnings_proximity` alone covers all positions ∪ watchlist.
- **`sentiment_shift` depends on a live local FinBERT service** — if it's down, zero notices, silently.
- **`event_impact`, `earnings_proximity`, `sentiment_shift` all require `FINNHUB_API_KEY`** — absent that key they return `[]` with no error surfaced.
- **No triggers exist** for: price/day-move alerts, dividend dates, tax-loss harvesting, cash-low or margin calls, or order fills (order notifications travel a separate Telegram path).

---

## Source files

`lib/noticed/engine.ts`, `lib/noticed/{bands,idle-cash,event-impact,bounce-back}.ts`,
`lib/insights/{deck,noticed-copy,threshold-badge,format}.ts`, `lib/concentration.ts`,
`lib/sector-targets.ts`, `app/api/ai/noticed/route.ts`, `lib/digest.ts`.
