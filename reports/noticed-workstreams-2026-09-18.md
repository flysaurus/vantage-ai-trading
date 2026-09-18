# Rufus Noticed — workstream investigation & design (2026-09-18)

Gate at start: 🟢 off-peak. **Nothing in §2/§3 implemented** — design/investigation first, per directive.

---

## 0. Cleanup BOUNCE_AVGO — ✅ DONE

Two rows existed (the old shared-login scoping bug produced a duplicate pair):

| row | account scope | state |
|---|---|---|
| `7ffee623-6469-4618-afae-80f14e99b494` | `snaptrade:0bf72384-…` (2-part, connection) | was **ACTIVE** — stranded zombie (created 2026-09-16T19:30) |
| `66cf1e4b-d086-4130-8b8d-6c8ca88b5710` | `snaptrade:0bf72384-…:47b6f4e3-…` (3-part, SMA) | already resolved (last_checked 2026-09-16T20:00:39) |

**Action:** soft-hid `7ffee623` → `resolved=true`. Row retained (reversible), matching the `a4551d71` precedent.
**⚠️ FLAGGED PROD WRITE** — `PATCH noticed_items?id=eq.7ffee623-…`. The only mutation in this whole leg.
Verified after: both `BOUNCE_AVGO` rows now `resolved=true`. The 2-part connection scope is now free of active zombies.

---

## 1. Candidate 2 — does the displayed "Contrarian" map to a valid `STYLE_SECTOR_TARGETS` key?

**VERDICT: the mapping is CORRECT. No fix needed. Two real findings fall out anyway.**

- "Contrarian" is the **shortLabel of archetype key `soros`** (`lib/content/investor-styles.ts:59`; `PILL_TRAITS.soros = 'Contrarian'`).
- `STYLE_SECTOR_TARGETS` (`lib/sector-targets.ts`) contains all five keys — `buffett, lynch, livermore, munger, soros`. So Contrarian → `soros` → **valid**.
- **Storage is the key, not the label:** live `users.investor_style = 'soros'` for the profile.
- Only two lookup sites, both key-based: `lib/noticed/engine.ts:202` (exact key) and `lib/ai/chart-registry.ts:292` (lower-cased key, `lynch` fallback). All ~20 `shortLabel`/`fullHeadline` uses are **render-only**. **No label-keyed lookup exists anywhere.**

**Finding A — fragility (not a bug).** `engine.ts:202` does `STYLE_SECTOR_TARGETS[investorStyle]` with no
normalisation and **silently returns `[]`** on an unknown key (`if (!targets) return triggers;`, no log).
Any future surface that passes a label or capitalised value makes drift vanish with zero signal.
Recommend a 1-line hardening: normalise (trim/lower-case) once + `console.warn` on unknown key.

**Finding B — product gap (real).** For a `soros` user the drift rule is **nearly inert by construction**:
soros targets are *Broad Market 35 / Fixed Income 30 / International 15 / Materials 10 / Cash 10*, and
**4 of the 5 are in `NON_SECTOR_BUCKETS`, which the rule skips**. Only **Materials** is ever compared —
and a US large-cap SMA won't deviate enough there. ⇒ **drift will essentially never fire for Contrarian users.**
This is not a mapping bug. If drift is meant to matter for Contrarian, the **soros target set itself needs a
sector-level definition** — a product decision. **Reported, not invented**, per instruction.

---

## 2. bounce_back redesign — v1 design + data availability

### Current (v0) behaviour — `lib/noticed/bounce-back.ts` (410 lines)
Four-filter **conjunction** (no score, no ranking tiers), firing at most **ONE notice per user per WEEK,
system-wide**, surfacing only the single most-discounted name and permanently excluding already-fired
symbols. No style gating. `MAX_SYMBOLS = 10` (top holdings by market value).

- (a) fundamentals intact — TTM revenue not declining **AND no latest-earnings miss** (a miss disqualifies).
- (b) decline is broad, not company-specific — ticker ≥10 % down over ~90 d, benchmark (sector ETF, SPY fallback) also down, ≤10 pp underperformance.
- (c) ≥20 % below the ticker's **own** 2–3 yr average P/E (fallback P/B).
- (d) no open review-tier event-impact trigger on the same symbol.

Data today: Finnhub `getFinancialMetrics` + `getEarningsSurprises`; Yahoo `fundamentalsTimeSeries`
(annual diluted EPS + year-end prices) for (c); `getCandles`; `SECTOR_ETF` map.

### v1 target — feasibility per element

| element | verdict | notes |
|---|---|---|
| scope per **user-broker-account** | ✅ feasible | `broker_accounts` registry (mig 077) + `resolveBrokerAccountReadFilter` exist; move the key namespace to per-account |
| **daily** re-eval + multiple firings/day | ✅ feasible | drop the weekly selector; key `BOUNCE_<SYMBOL>` per account is already idempotent, so a same-day re-fire is just "still active" |
| **multiple symbols/pass** + concurrent-active cap | ✅ feasible | proposed cap **4** (rationale below) |
| keep filters **(b)** and **(c)** | ✅ unchanged | both already work as designed |
| filter **(a)** → materiality | ⚠️ **partial** | see data table |
| new signal: **same-stock historical reversion** | ⚠️ **needs a small data-layer extension** | see below |

**Proposed concurrent-active cap: 4 per account.** Rationale: (i) the deck is deliberately narrow and your
complaint was *too little*, not too much — but v1 drops the single-most-discounted cap and the SMA holds 349
names, so unbounded firing would flood "More from Rufus"; (ii) 4 ≈ one live card + a short queue, which keeps
the feed readable; (iii) it sits well under the `MAX_SYMBOLS = 10` scan fan-out, so one pass can't saturate
itself. (Your suggested 3–5; 4 is the middle and maps cleanly to a row of cards. Easy to make a constant.)

### Filter (a) → materiality: honest data availability

| materiality question | data support | verdict |
|---|---|---|
| how big was the miss, vs its own history? | Finnhub `getEarningsSurprises` — actual/estimate/surprise %, multi-quarter, newest-first | ✅ |
| was the market reaction disproportionate to the news? | price move around the earnings date vs sector-ETF/SPY move (`getCandles` daily + earnings date) | ✅ computable |
| was the miss in line with sector peers? | no per-peer mapping; only `SECTOR_ETF` sector proxy | ⚠️ sector proxy only, not true peers |
| was guidance reaffirmed? | **no guidance data source** — nothing wired in `lib/finnhub.ts`; Finnhub free tier exposes no guidance endpoint here | ❌ blocked without a new source |
| one-time item? | only via news text (`getCompanyNews`) → needs NLP; FinBERT is down / keyword-only today | ❌ not deterministic |

⇒ **Recommendation:** build (a) as a composite of **only the measurable parts** — (1) miss magnitude
*relative to the ticker's own 4-quarter surprise distribution* (a miss is material only if materially worse
than its own norm), (2) disproportionate-reaction test vs benchmark, plus the existing revenue-trend check.
**Do not fabricate a numeric "materiality score"** from inputs we don't have; guidance + one-time-item need a
real source first (flagged, not invented).

### New signal — same-stock historical reversion

- The **idea is computable with no cross-stock matching** ✅ (exactly as you said).
- **But the data layer can't serve it at daily granularity today:** `getCandles` maps resolution →
  *fixed* Yahoo ranges — `D` → **3mo**, `W` → 1y, `M` → 2y (monthly). Multi-year **daily** history is not
  exposed, and "similarly-sized drawdowns in its own history + what happened next" needs it.
- **Small, safe fix:** add a long-range daily option to `getCandles` (Yahoo supports `range=5y&interval=1d`)
  — new resolution key or a `range` param. Then the signal = find past windows where the ticker drew down
  ≥ X % within ≤ N days, build the forward 20/60-day return distribution, and fire when today's drawdown
  sits in the historically-reverting part of that distribution.
- **Perf caution:** 349 positions × 5 y daily candles is heavy — restrict to the candidate set (top-N by MV)
  and cache.

**v2 (explicitly OUT of scope, flagged as a future phase):** cross-stock analog matching — needs a
universe-wide history store. **Flagged, not built.**

---

## 3. New triggers — data availability

| # | trigger | data source | verdict |
|---|---|---|---|
| 1 | price / day-move alert (badge, position_milestone-shaped) | quotes already in use (Finnhub `/quote`, Alpaca) | ✅ ready |
| 2 | dividend dates (digest-only) | today only dividend **yield/rate**; **no ex-date/pay-date calendar**. Finnhub has a `/stock/dividend` endpoint but it is **not wired** in `lib/finnhub.ts` | ⚠️ needs a new source — confirm endpoint + free-tier coverage **before** building |
| 3 | TLH opportunity | `lib/wash-sale.ts` — `checkWashSale`, `unionBuyFills`, `findRecentBuys`, 30-day window | ✅ build **on** this; hard guard: never surface a harvest that would trip wash-sale |
| 4 | margin / cash-low warning | **INVESTIGATE FIRST — `buying_power` is NOT trustworthy.** SnapTrade connect-time snapshots are stale (the $100,865.95 Alpaca fabrication) and the cash-honesty contract says an unknown balance is **never** $0 | ⚠️ **do not build on `buying_power`.** If built, use the resolved *live* cash path (`resolveLiveAccountCash` / `daily_cash_snapshots`) and stay **silent when cash is UNKNOWN**. Recommend reporting the reliability evidence before any build |
| 5 | analyst rating / price-target change | Finnhub `getRecommendationTrends` + `getPriceTarget`; Yahoo `upgradeDowngradeHistory` AnalystSummary already exists | ✅ ready |
| 6 | 52-week high/low badge | `high52w` / `low52w` (Finnhub `/stock/metric` + Yahoo meta, cached enrichment pass) | ✅ ready |
| 7 | account-level milestone | account equity/summary | ✅ ready — needs a **separate key namespace** (e.g. `ACCOUNT_MILESTONE_<threshold>` vs `MILESTONE_<SYMBOL>_<band>`) so they never collide |

---

## 4. Asks before implementation

1. Filter (a): OK to build the **measurable composite only**, with guidance/one-time-item treated as
   *blocked-until-source*?
2. `getCandles` long-range daily extension — OK to add (needed for the historical-reversion signal)?
3. Finding B (§1): `soros` targets make drift nearly inert — product call needed.
4. Concurrent-active cap of **4** OK, or pick 3/5?

---

## 5. (4) Soros-drift — findings + proposal

### (4b) Which archetypes are hollowed by the non-sector skip? — MEASURED (not eyeballed)

Global skip list = `{Broad Market, Cash, Fixed Income, International}`. Computed live from
`STYLE_SECTOR_TARGETS` × `NON_SECTOR_BUCKETS`:

| archetype | comparable sectors | % of target set | verdict |
|---|---|---|---|
| buffett | 5 — FS 30, Consumer 20, Healthcare 15, Tech 15, Industrials 5 | **85 %** | OK |
| lynch | 5 — Tech 35, Consumer 20, Healthcare 15, FS 10, Industrials 5 | **85 %** | OK |
| livermore | 4 — Tech 45, Consumer 20, FS 10, Media & Ent 10 | **85 %** | OK |
| munger | 4 — FS 25, Consumer 20, Healthcare 15, Utilities 10 | **70 %** | OK (thinnest but legitimate) |
| soros | **1 — Materials 10** | **10 %** | **HOLLOWED** |

⇒ **Only `soros` is damaged.** The four equity archetypes each keep 4–5 real sector buckets
(70–85 % of allocation). munger is the thinnest of the four, but its skipped 30 % (Broad Market 25 +
Cash 5) is skipped *by design* and the remaining four sectors are a real, comparable set.

### (4c) Proposal — report before building (product-shape decision)

Root cause: **`soros` is a macro / cross-asset archetype.** Its target set is deliberately
*Broad Market 35 / Fixed Income 30 / International 15 / Materials 10 / Cash 10* — it has essentially
**no GICS sector granularity** to compare, so at sector level only Materials survives.

Two shapes:

- **A. Give `soros` real sector-level granularity** — write a sector target set for a contrarian/macro tilt.
  **Rejected (for now).** It means **inventing allocation numbers** someone has to own, and it fights the
  archetype: a macro investor isn't trying to hold "15 % Healthcare" — their thesis *is* the asset-class mix.
- **B. ✅ Style-aware bucket policy (recommended).** Make the non-sector skip **style-aware**: skip a
  bucket only when the style doesn't target it. Equity archetypes are unchanged (they don't target the macro
  buckets). For `soros`, drift then compares **asset-class buckets directly** — Broad Market / Fixed Income /
  International / Materials (Cash still skipped — that's the idle-cash rule's job).
  - **Zero invented numbers** — it uses the targets already defined.
  - The buckets are **already computed**: `decomposePositionValue` (via `resolveEtfWeightsForPositions`)
    returns 'Broad Market' / 'Fixed Income' / 'International' for ETFs, and `findDriftTriggers` already
    aggregates them into `sectorValues` — it just discards them at the `NON_SECTOR_BUCKETS.has(sector)` line.
  - It matches what the style is *supposed* to watch: a macro archetype should be alerted when its
    **asset-class mix** drifts, not when a GICS sector does.
  - Change is small: `if (NON_SECTOR_BUCKETS.has(sector) && !(sector in targets)) continue;` (+ keep skipping Cash).
  - **Risk / guard:** ETF decomposition quality drives signal quality (the SMA had 252/349 positions with
    no sector — separate issue), and macro bucket drift will be noisier. Propose a **shadow phase first**:
    log what *would* fire for 1–2 passes before enabling live cards.

### (4a) Hardening — patch ready, not applied (per "report before implementing")
`lib/noticed/engine.ts:202` — normalise the key (`trim().toLowerCase()`) and `console.warn` on an unknown
style key instead of silently returning `[]`. Two lines. Say go and it ships in the next batch.

---

## 6. Build plan for the approved items (1)-(3)

Branch: `feat/bounce-back-v1`.

1. **(2) `getCandles` long-range daily** — add a `'D5y'` resolution → Yahoo `range=5y&interval=1d`, and
   route it **straight to Yahoo** (Alpaca's `1Day` path is limit-capped and can't cover 5 y).
2. **(1) bounce_back v1** — in `lib/noticed/bounce-back.ts`:
   - drop weekly/system-wide single-fire → **daily, multi-symbol, per-account** (pipeline is already
     account-scoped; key `BOUNCE_<SYMBOL>` is already per-account unique).
   - replace `selectWeeklyBounceBack` with a **concurrent-active cap of 4/account**.
   - filter (a) → **measurable composite**: revenue trend (kept) + **miss magnitude vs the ticker's own
     4-quarter surprise distribution** + **disproportionate reaction vs benchmark**.
     ⚠️ The reaction test needs an earnings **announcement date**; `getEarningsSurprises` only carries the
     fiscal `period`, so this needs a small added Finnhub earnings-calendar fetch — flagged, to be verified
     live before wiring.
   - new signal: **same-stock historical reversion** off the new 5 y daily candles.
   - keep (b), (c) unchanged.
3. **(3)** cap constant 4 exported and covered by tests.
