/**
 * Bounce-back candidate trigger — deterministic "quality position, temporarily
 * discounted" notice for AI Noticed.
 *
 * Fires a single, non-urgent, review-oriented notice when a ticker the user
 * ALREADY HOLDS is a quality position trading at a temporary discount. This is
 * the *opposite* of an event-impact alert: instead of a company-specific
 * problem, we detect a name whose fundamentals are intact but whose price has
 * sagged with the broader market/sector — the "buy the dip on something you
 * already believe in" signal, framed strictly as "worth a look", never as a
 * trade instruction.
 *
 * Four filters (CONJUNCTION — all must pass; no score, no ranking tiers):
 *   (a) Fundamentals intact — TTM revenue not declining AND no *material,
 *       company-specific* earnings miss. v0 disqualified ANY miss; v1 asks how
 *       big the miss was relative to the ticker's OWN trailing surprise history
 *       AND whether the market singled the name out around the report date
 *       (ticker vs its benchmark). A small miss in line with its own norm, or a
 *       miss the market took in stride with the sector, stays eligible.
 *
 *       ⚠️ MEASUREMENT LIMIT (verified live 2026-09-18): the report-date part of
 *       this test can only be measured for names that reported inside Finnhub's
 *       ~6-week earnings-calendar retention window. Older reports ⇒ reaction
 *       UNKNOWN ⇒ filter (a) collapses to miss-magnitude-vs-own-history for that
 *       name (never a guess, never a disqualification). Per Em: do NOT
 *       approximate the announcement date from the fiscal period.
 *   (b) Broad market/sector decline, not company-specific — the ticker is down
 *       at least MIN_DECLINE_PCT over the window, the benchmark (sector ETF, or
 *       SPY fallback) is ALSO down, and the ticker is not underperforming the
 *       benchmark by more than MAX_UNDERPERFORM_PP.
 *   (c) Valuation below the ticker's own trailing 2–3yr average — current P/E
 *       (fallback P/B) is ≥20% below its own multi-year average, computed from
 *       Yahoo `fundamentalsTimeSeries` (annual diluted EPS + year-end prices).
 *   (d) No open review-tier event-impact trigger on the same symbol — if we're
 *       already flagging a genuine company event, don't ALSO claim "the dip is
 *       just the market."
 *   (e) EVIDENCE ONLY (v1, not a gate) — same-stock historical reversion: how did
 *       this ticker behave after past drawdowns of a comparable depth? Recorded
 *       on the card's meta and mentioned in the copy when the sample is large
 *       enough. Deliberately NOT a firing gate yet so incomplete history can't
 *       silently suppress cards.
 *
 * Frequency (v1): re-evaluated on EVERY pass (daily + intraday), per
 * user-broker-account, surfacing MULTIPLE names per pass. What keeps the deck
 * readable is MAX_CONCURRENT_ACTIVE (4) concurrent active bounce-back cards per
 * account — NOT a weekly selector. v0's one-per-week system-wide cap and its
 * permanent `previouslyFiredSymbols` exclusion are both gone, so a name can
 * re-fire after its card resolves. No style-gating.
 *
 * Deterministic firing path (keyword/data thresholds only — no LLM in the
 * firing decision). The LLM only rewords the copy, which is already
 * tone-compliant, so the budget-exhausted fallback carries the same voice.
 *
 * Reuses [ACTION:REVIEW_POSITION:TICKER] + ActionButton — no new UI component.
 */

import type { NoticedRuleInput, NoticedTrigger } from './engine';
import { getFinancialMetrics, getEarningsSurprises, getEarningsCalendar } from '@/lib/finnhub';
import { getCandles } from '@/lib/market-data';

// ── Config ──
const DECLINE_WINDOW_DAYS = 90;   // ~90-day window for filter (b)
const MIN_DECLINE_PCT = 10;       // ticker must be down at least this much
const MAX_UNDERPERFORM_PP = 10;   // ticker may trail benchmark by at most this many pp
const DISCOUNT_THRESHOLD = 0.2;   // ≥20% below own historical average (filter c)
const MIN_YEARS = 2;              // need ≥2 annual valuation points for a norm
const MAX_SYMBOLS = 10;           // top holdings by market value (same fan-out as event-impact)

// ── v1: concurrency cap + materiality + historical-reversion evidence ──
/**
 * Concurrent-active cap, per user-broker-account. v0 allowed ONE new bounce-back
 * per user per WEEK (system-wide); v1 re-evaluates every pass and can surface
 * several names at once, so THIS cap — not a weekly selector — is what keeps the
 * deck readable. 4 ≈ one live card plus a short queue, and it sits well under the
 * MAX_SYMBOLS scan fan-out so a single pass can't saturate itself.
 */
export const MAX_CONCURRENT_ACTIVE = 4;

/** A reported miss is only "material" if it is at least this far below zero … */
const MATERIAL_MISS_PCT = 2;
/** … AND at least this many pp worse than the ticker's own trailing median surprise. */
const MATERIAL_MISS_PP = 3;
/** The reaction is "company-specific" when the ticker trails its benchmark by ≥ this (pp). */
const REACTION_EXCESS_PP = 3;
/** Days either side of the report date used to measure the reaction. */
const REACTION_HALF_WINDOW_DAYS = 1;
/** Look-back (days) when searching for a comparable past drawdown episode. */
const REVERSION_EPISODE_DAYS = 90;
/** Forward window (days) used to measure what followed a past drawdown. */
const REVERSION_FORWARD_DAYS = 60;
/** Minimum historical episodes before the reversion evidence is surfaced. */
const REVERSION_MIN_SAMPLE = 3;

// ── Sector → benchmark ETF map (SPY fallback for anything unknown) ──
export const SECTOR_ETF: Record<string, string> = {
  Technology: 'XLK',
  Healthcare: 'XLV',
  'Financial Services': 'XLF',
  'Consumer Defensive': 'XLP',
  'Consumer Cyclical': 'XLY',
  Consumer: 'XLY',
  Energy: 'XLE',
  Industrials: 'XLI',
  'Media & Entertainment': 'XLC',
  Materials: 'XLB',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
  Automotive: 'XLY',
};

// Non-equity sector buckets we never evaluate (funds/ETFs/bonds — no company
// fundamentals, so filters (a)/(c) would always fail anyway).
const NON_EQUITY_SECTORS = new Set([
  'Broad Market',
  'Fixed Income',
  'International',
  'Commodities',
]);

// ── Types ──
/** Filter (a) materiality assessment — how bad was the miss, really? */
export interface MaterialityAssessment {
  latestSurprisePct: number | null;
  medianSurprisePct: number | null;    // the ticker's own trailing norm (excluding the latest)
  missIsMaterial: boolean;             // magnitude vs its OWN history
  reactionExcessPp: number | null;     // ticker − benchmark around the report date (null = unmeasurable)
  reactionCompanySpecific: boolean;    // market singled the name out
  disqualified: boolean;               // material AND company-specific ⇒ fundamentals not intact
  reason: string | null;
}

/** Same-stock historical reversion evidence (v1: evidence only, never a gate). */
export interface HistoricalReversion {
  sample: number;                 // comparable past drawdown episodes found
  medianForwardPct: number | null;
  positiveRate: number | null;    // share that were higher REVERSION_FORWARD_DAYS later
  sufficient: boolean;            // sample >= REVERSION_MIN_SAMPLE
}

export interface BounceCandidate {
  symbol: string;
  discountType: 'pe' | 'pb';
  discountPct: number;      // % below own historical average (positive = discounted)
  peCurrent: number | null;
  peAvg: number | null;
  pbCurrent: number | null;
  pbAvg: number | null;
  tickerRet: number;
  benchmarkRet: number;
  benchmarkSymbol: string;
  years: number;
  materiality: MaterialityAssessment | null;
  historical: HistoricalReversion | null;
}

/** Pre-fetched inputs to the pure decision function (testable without network). */
export interface BounceBackData {
  revenueGrowthTTM: number | null;
  /** Own trailing surprises, newest-first (e.g. last 4 quarters). */
  surpriseHistoryPct: number[];
  /** Ticker minus benchmark return over the report-date window (null = unknown). */
  earningsReactionExcessPp: number | null;
  tickerRet: number | null;
  benchmarkRet: number | null;
  peCurrent: number | null;
  peAvg: number | null;
  pbCurrent: number | null;
  pbAvg: number | null;
  years: number;
}

// ── Pure materiality assessment for filter (a) (no I/O) ──
/** Median of a numeric array (null when empty). */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * v1 replacement for the blunt "any miss disqualifies" test.
 *
 * A miss counts as MATERIAL only when it is both (i) at least MATERIAL_MISS_PCT
 * below zero and (ii) at least MATERIAL_MISS_PP worse than the ticker's OWN
 * trailing median surprise — i.e. bad *for this company*, not merely negative.
 * It counts as COMPANY-SPECIFIC only when we can actually measure the report-date
 * reaction and the ticker trailed its benchmark by REACTION_EXCESS_PP or more.
 *
 * Disqualification requires BOTH. If the reaction cannot be measured (no report
 * date, or the report is older than the candle window) we do NOT disqualify —
 * absent evidence, we don't invent it.
 */
export function assessMateriality(
  surpriseHistoryPct: number[],
  reactionExcessPp: number | null,
): MaterialityAssessment {
  const history = (surpriseHistoryPct || []).filter((v) => v != null && Number.isFinite(v));
  const latest = history.length ? history[0] : null;
  const medianSurprisePct = history.length > 1 ? median(history.slice(1)) : null;

  const base: MaterialityAssessment = {
    latestSurprisePct: latest,
    medianSurprisePct,
    missIsMaterial: false,
    reactionExcessPp,
    reactionCompanySpecific: false,
    disqualified: false,
    reason: null,
  };

  // No miss (or no data) ⇒ nothing to assess.
  if (latest == null || latest >= 0) return base;

  const missIsMaterial =
    latest <= -MATERIAL_MISS_PCT &&
    (medianSurprisePct == null || latest <= medianSurprisePct - MATERIAL_MISS_PP);

  const reactionCompanySpecific =
    reactionExcessPp != null && reactionExcessPp <= -REACTION_EXCESS_PP;

  const disqualified = missIsMaterial && reactionCompanySpecific;

  return {
    ...base,
    missIsMaterial,
    reactionCompanySpecific,
    disqualified,
    reason: disqualified
      ? `latest quarter missed by ${latest.toFixed(1)}% and the stock trailed its benchmark by ` +
        `${Math.abs(reactionExcessPp as number).toFixed(1)}pp around the report`
      : missIsMaterial && reactionExcessPp == null
        ? 'quarter missed, but the report-date reaction could not be measured'
        : null,
  };
}

// ── Pure decision: the 4-filter conjunction (no I/O) ──
export function evaluateBounceBack(d: BounceBackData): {
  discountType: 'pe' | 'pb';
  discountPct: number;
  materiality: MaterialityAssessment;
} | null {
  // (a) Fundamentals intact — revenue must be present and not declining; a
  //     MATERIAL + COMPANY-SPECIFIC earnings miss disqualifies (v0 disqualified
  //     any miss at all; v1 only when the miss is bad for THIS company AND the
  //     market singled it out).
  if (d.revenueGrowthTTM == null || d.revenueGrowthTTM < 0) return null;
  const materiality = assessMateriality(d.surpriseHistoryPct || [], d.earningsReactionExcessPp ?? null);
  if (materiality.disqualified) return null;

  // (b) Broad decline — ticker down ≥10%, benchmark also down, and the ticker
  //     isn't underperforming the benchmark by more than MAX_UNDERPERFORM_PP.
  if (d.tickerRet == null || d.benchmarkRet == null) return null;
  if (!(d.tickerRet <= -MIN_DECLINE_PCT)) return null;
  if (!(d.benchmarkRet < 0)) return null;
  if (!(d.tickerRet - d.benchmarkRet >= -MAX_UNDERPERFORM_PP)) return null;

  // (c) Valuation below own history — P/E primary, P/B fallback.
  //   Compare with an epsilon so the exact 20% boundary (a real floating-point
  //   case: 20/25 = 0.8000...4) doesn't spuriously fail; round the returned
  //   percentage for clean ranking/display.
  if (d.peCurrent != null && d.peCurrent > 0 && d.peAvg != null && d.peAvg > 0) {
    const discountPct = (1 - d.peCurrent / d.peAvg) * 100;
    if (discountPct >= DISCOUNT_THRESHOLD * 100 - 1e-9) {
      return { discountType: 'pe', discountPct: Math.round(discountPct * 100) / 100, materiality };
    }
  }
  if (d.pbCurrent != null && d.pbCurrent > 0 && d.pbAvg != null && d.pbAvg > 0) {
    const discountPct = (1 - d.pbCurrent / d.pbAvg) * 100;
    if (discountPct >= DISCOUNT_THRESHOLD * 100 - 1e-9) {
      return { discountType: 'pb', discountPct: Math.round(discountPct * 100) / 100, materiality };
    }
  }

  return null;
}

// ── Pure historical-reversion evidence (no I/O) ──
/**
 * Same-stock historical reversion: find past episodes where THIS ticker drew
 * down at least as deeply as it has now (within a trailing window), then measure
 * what happened over the following REVERSION_FORWARD_DAYS.
 *
 * Episodes are armed/disarmed so one long drawdown counts once: an episode is
 * recorded when the trailing drawdown first reaches the threshold, and a new one
 * can only be recorded after the drawdown recovers past half the threshold.
 *
 * EVIDENCE ONLY in v1 — never gates firing.
 */
export function computeHistoricalReversion(
  bars: { t: number; c: number }[],
  currentDropPct: number,
): HistoricalReversion | null {
  const closes = (bars || [])
    .filter((b) => b && Number.isFinite(b.t) && Number.isFinite(b.c) && b.c > 0)
    .sort((a, b) => a.t - b.t);
  if (closes.length < REVERSION_EPISODE_DAYS + 10) return null;
  if (!Number.isFinite(currentDropPct) || currentDropPct >= 0) return null;

  const fwd: number[] = [];
  let armed = true;
  for (let i = 0; i < closes.length; i++) {
    let peak = -Infinity;
    for (let j = Math.max(0, i - REVERSION_EPISODE_DAYS + 1); j <= i; j++) {
      if (closes[j].c > peak) peak = closes[j].c;
    }
    const dd = peak > 0 ? ((closes[i].c - peak) / peak) * 100 : 0;
    if (armed && dd <= currentDropPct) {
      const endIdx = Math.min(closes.length - 1, i + REVERSION_FORWARD_DAYS);
      if (endIdx > i) fwd.push(((closes[endIdx].c - closes[i].c) / closes[i].c) * 100);
      armed = false;
    } else if (!armed && dd > currentDropPct / 2) {
      armed = true;
    }
  }

  return {
    sample: fwd.length,
    medianForwardPct: median(fwd),
    positiveRate: fwd.length ? fwd.filter((x) => x > 0).length / fwd.length : null,
    sufficient: fwd.length >= REVERSION_MIN_SAMPLE,
  };
}

// ── Pure selection: concurrent-active cap + keep-alive persistence (v1) ──
/**
 * v1 selection — replaces the weekly single-fire selector.
 *
 * - `keepAlive`: still-qualifying candidates whose card is ALREADY active. Their
 *   keys stay in the firing set so the pipeline's stale-resolve step doesn't
 *   dissolve them a day later (the trulyNew filter still skips them, so no
 *   duplicate card).
 * - `fire`: qualifying candidates without an active card, most-discounted first,
 *   limited to the remaining room under `cap`.
 *
 * Note the cap counts ACTIVE cards, not fresh fires, so a pass can never push the
 * account above `cap`. There is no permanent fired-symbol exclusion any more.
 */
export function selectBounceBackCandidates(
  candidates: BounceCandidate[],
  activeKeys: Set<string>,
  cap: number = MAX_CONCURRENT_ACTIVE,
): { fire: BounceCandidate[]; keepAlive: BounceCandidate[] } {
  const isActive = (c: BounceCandidate) => activeKeys.has(`BOUNCE_${c.symbol}`);
  const keepAlive = candidates.filter(isActive);
  const fresh = candidates.filter((c) => !isActive(c));
  fresh.sort((a, b) => b.discountPct - a.discountPct);
  const room = Math.max(0, cap - keepAlive.length);
  return { fire: fresh.slice(0, room), keepAlive };
}

// ── Pure trigger builder (tone-compliant deterministic copy) ──
export function buildBounceBackTrigger(c: BounceCandidate): NoticedTrigger {
  const valuation =
    c.discountType === 'pe'
      ? `P/E of ${c.peCurrent!.toFixed(1)} vs its own ${c.years}-year average of ${c.peAvg!.toFixed(1)}`
      : `P/B of ${c.pbCurrent!.toFixed(2)} vs its own ${c.years}-year average of ${c.pbAvg!.toFixed(2)}`;

  // v1: describe the earnings picture HONESTLY — a small miss that stayed in
  // line with its own history is no longer asserted away as "didn't miss".
  const m = c.materiality;
  let earningsLine: string;
  if (!m || m.latestSurprisePct == null) {
    earningsLine = 'Earnings history is intact';
  } else if (m.latestSurprisePct >= 0) {
    earningsLine = `The latest quarter beat estimates by ${m.latestSurprisePct.toFixed(1)}%`;
  } else if (m.missIsMaterial) {
    earningsLine =
      `The latest quarter came in ${Math.abs(m.latestSurprisePct).toFixed(1)}% light, though the ` +
      `market's reaction tracked the broader move rather than this name alone`;
  } else {
    earningsLine =
      `The latest quarter landed ${Math.abs(m.latestSurprisePct).toFixed(1)}% under expectations, ` +
      `in line with its own recent reporting`;
  }

  // Same-stock historical reversion — evidence only, mentioned when credible.
  const rev = c.historical;
  const reversionLine =
    rev && rev.sufficient && rev.positiveRate != null
      ? ` Over the last 5 years, ${rev.sample} comparable drawdowns in ${c.symbol} were followed by a ` +
        `higher price ${Math.round(rev.positiveRate * 100)}% of the time within ${REVERSION_FORWARD_DAYS} days.`
      : '';

  return {
    trigger_type: 'bounce_back',
    trigger_key: `BOUNCE_${c.symbol}`,
    title: `${c.symbol} — quality position, temporarily discounted`,
    variant: 'accent',
    icon: '🔎',
    meta: {
      symbol: c.symbol,
      action: `REVIEW_POSITION:${c.symbol}`,
      discountType: c.discountType,
      discountPct: Math.round(c.discountPct * 10) / 10,
      peCurrent: c.peCurrent,
      peAvg: c.peAvg,
      pbCurrent: c.pbCurrent,
      pbAvg: c.pbAvg,
      tickerRet: c.tickerRet,
      benchmarkRet: c.benchmarkRet,
      benchmarkSymbol: c.benchmarkSymbol,
      // v1 materiality — measurable parts only (never a fabricated score).
      latestSurprisePct: m?.latestSurprisePct ?? null,
      medianSurprisePct: m?.medianSurprisePct ?? null,
      missIsMaterial: m?.missIsMaterial ?? false,
      reactionExcessPp: m?.reactionExcessPp ?? null,
      reactionCompanySpecific: m?.reactionCompanySpecific ?? false,
      // v1 historical-reversion evidence (evidence only — does not gate).
      reversionSample: rev?.sample ?? null,
      reversionPositiveRate: rev?.positiveRate ?? null,
      reversionMedianForwardPct: rev?.medianForwardPct ?? null,
    },
    follow_up: `Want to review ${c.symbol}?`,
    context:
      `${c.symbol} is a quality position trading at a temporary discount. ` +
      `Fundamentals are intact — revenue is still growing. ${earningsLine}. ` +
      `The recent ~${DECLINE_WINDOW_DAYS}-day pullback (${c.tickerRet.toFixed(1)}%) tracked the broader ` +
      `${c.benchmarkSymbol} move (${c.benchmarkRet.toFixed(1)}%) rather than a company-specific problem. ` +
      `It now trades at a ${valuation} (about ${Math.round(c.discountPct)}% below).${reversionLine} ` +
      `Worth reviewing the position yourself.`,
  };
}

// ── Data helpers ──

async function getYahoo() {
  const { default: YahooFinance } = await import('yahoo-finance2');
  return new YahooFinance({ suppressNotices: ['yahooSurvey'] });
}

/** % return of `symbol` over the trailing `days` window (first→last close). */
async function getWindowReturn(symbol: string, days: number): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - days * 86400;
  const candles = await getCandles(symbol, 'D', from, now);
  if (!candles || candles.length < 2) return null;
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  if (!first || !last || first <= 0) return null;
  return ((last - first) / first) * 100;
}

interface HistoricalValuation {
  avgPE: number | null;
  avgPB: number | null;
  years: number;
}

/**
 * Trailing 2–4yr annual P/E and P/B averages from Yahoo `fundamentalsTimeSeries`
 * (annual diluted EPS + book value per share) paired with month-end prices from
 * `chart`. Annual valuation = month-end close at/before the fiscal period end ÷
 * per-share metric. Returns null averages when fewer than MIN_YEARS points exist.
 */
async function getHistoricalValuation(symbol: string): Promise<HistoricalValuation> {
  const yf = await getYahoo();
  const period1 = new Date(Date.now() - 4 * 365 * 86400000).toISOString().slice(0, 10);
  const period2 = new Date().toISOString().slice(0, 10);

  let financials: any[] = [];
  let balanceSheet: any[] = [];
  try {
    financials = await yf.fundamentalsTimeSeries(symbol, {
      module: 'financials',
      type: 'annual',
      period1,
      period2,
    });
  } catch { /* best-effort */ }
  try {
    balanceSheet = await yf.fundamentalsTimeSeries(symbol, {
      module: 'balance-sheet',
      type: 'annual',
      period1,
      period2,
    });
  } catch { /* best-effort */ }

  let monthly: any[] = [];
  try {
    const q = await yf.chart(symbol, { period1, period2, interval: '1mo' });
    monthly = q?.quotes || [];
  } catch { /* best-effort */ }

  const monthlySorted = monthly
    .map((m) => ({ t: m?.date ? new Date(m.date).getTime() : NaN, c: Number(m?.close) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.c) && x.c > 0)
    .sort((a, b) => a.t - b.t);

  // Month-end close at/before the fiscal period end date.
  const priceAt = (target: Date): number | null => {
    let found: number | null = null;
    for (const x of monthlySorted) {
      if (x.t <= target.getTime() + 1) found = x.c;
      else break;
    }
    return found;
  };

  const peList: number[] = [];
  for (const f of financials) {
    const d = f?.date ? new Date(f.date) : null;
    const eps = Number(f?.dilutedEPS);
    if (!d || !Number.isFinite(eps) || eps <= 0) continue;
    const close = priceAt(d);
    if (close == null) continue;
    peList.push(close / eps);
  }

  const pbList: number[] = [];
  for (const b of balanceSheet) {
    const d = b?.date ? new Date(b.date) : null;
    const equity = Number(b?.stockholdersEquity);
    const shares = Number(b?.ordinarySharesNumber);
    if (!d || !Number.isFinite(equity) || !Number.isFinite(shares) || equity <= 0 || shares <= 0) continue;
    const close = priceAt(d);
    if (close == null) continue;
    pbList.push(close / (equity / shares));
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  const avgPE = peList.length >= MIN_YEARS ? avg(peList) : null;
  const avgPB = pbList.length >= MIN_YEARS ? avg(pbList) : null;

  return { avgPE, avgPB, years: Math.max(peList.length, pbList.length) };
}

// ── Materiality helpers (v1) ──

/**
 * Most recent PAST earnings report date (YYYY-MM-DD) for a symbol, or null.
 *
 * ⚠️ VERIFIED LIVE 2026-09-18: Finnhub's `/calendar/earnings` retains only a
 * ~6-WEEK history window. Probed no-symbol windows: 2026-08-05→08-15 → 0 rows,
 * 2026-08-09→08-19 → 72 rows, i.e. the endpoint starts serving data around
 * 2026-08-10 (≈40 days back). So this resolves ONLY names that reported within
 * roughly the last 40 days; anything older returns null and we say UNKNOWN
 * rather than guessing (the resulting materiality read is magnitude-only).
 *
 * We use the CALENDAR, not `/stock/earnings`: the latter exposes only the fiscal
 * `period` (quarter end), which is not the announcement date and cannot anchor a
 * market-reaction window.
 */
async function getLastReportDate(symbol: string): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  // 45d matches the endpoint's retention horizon; a longer span adds no rows.
  const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const rows = await getEarningsCalendar(symbol, from, today);
  const past = rows
    .filter((r) => r.date && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return past.length ? past[past.length - 1].date : null;
}

/**
 * Report-date reaction: the ticker's return minus its benchmark's return across
 * [report − REACTION_HALF_WINDOW_DAYS, report + REACTION_HALF_WINDOW_DAYS].
 *
 * Returns null when the report sits outside the fetched candle window or data is
 * missing — an unmeasurable reaction is reported as UNKNOWN, never guessed.
 */
async function getReportDateReactionExcess(
  symbol: string,
  benchmarkSymbol: string,
): Promise<number | null> {
  const reportDate = await getLastReportDate(symbol);
  if (!reportDate) return null;
  const target = Date.parse(`${reportDate}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;

  const now = Date.now();
  const from = Math.floor((now - (DECLINE_WINDOW_DAYS + 10) * 86400000) / 1000);
  const to = Math.floor(now / 1000);

  const [tCandles, bCandles] = await Promise.all([
    getCandles(symbol, 'D', from, to),
    getCandles(benchmarkSymbol, 'D', from, to),
  ]);

  const reaction = (candles: { timestamp: number; close: number }[] | null): number | null => {
    if (!candles || candles.length < 3) return null;
    const arr = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    let idx = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].timestamp <= target) idx = i;
    }
    if (idx < 1) return null; // report predates the fetched window
    const s = Math.max(0, idx - REACTION_HALF_WINDOW_DAYS);
    const e = Math.min(arr.length - 1, idx + REACTION_HALF_WINDOW_DAYS);
    if (e <= s) return null;
    const a = arr[s].close;
    const b = arr[e].close;
    if (!a || a <= 0 || !b) return null;
    return ((b - a) / a) * 100;
  };

  const t = reaction(tCandles as any);
  const b = reaction(bCandles as any);
  if (t == null || b == null) return null;
  return t - b;
}

/** Fetch 5y daily closes and derive the same-stock reversion evidence. */
async function getHistoricalReversion(
  symbol: string,
  currentDropPct: number,
): Promise<HistoricalReversion | null> {
  try {
    const bars = await getCandles(symbol, 'D5y');
    if (!bars || !bars.length) return null;
    return computeHistoricalReversion(
      bars.map((b) => ({ t: b.timestamp, c: b.close })),
      currentDropPct,
    );
  } catch (err: any) {
    console.warn(`[noticed] Historical-reversion lookup failed for ${symbol}:`, err?.message || err);
    return null;
  }
}

// ── Main finder ──
export async function findBounceBackTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
  reviewEventSymbols: Set<string>,
): Promise<NoticedTrigger[]> {
  const triggers: NoticedTrigger[] = [];

  const top = [...input.positions]
    .filter((p) => !NON_EQUITY_SECTORS.has(p.sector || ''))
    .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
    .slice(0, MAX_SYMBOLS);

  if (top.length === 0) return triggers;

  // Cache benchmark returns by ETF symbol (multiple holdings share a sector ETF).
  const benchCache = new Map<string, number | null>();
  const benchmarkReturn = async (sector: string | undefined): Promise<number | null> => {
    const etf = SECTOR_ETF[sector || ''] || 'SPY';
    if (!benchCache.has(etf)) {
      benchCache.set(etf, await getWindowReturn(etf, DECLINE_WINDOW_DAYS));
    }
    return benchCache.get(etf) ?? null;
  };

  const candidates: BounceCandidate[] = [];

  await Promise.allSettled(
    top.map(async (pos) => {
      const symbol = pos.symbol.toUpperCase();
      const benchmarkSymbol = SECTOR_ETF[pos.sector || ''] || 'SPY';

      // Filter (d) — skip symbols already flagged by a review-tier event.
      if (reviewEventSymbols.has(symbol)) return;

      try {
        const metrics = await getFinancialMetrics(symbol);
        if (!metrics) return;

        // (a) own trailing surprise history, newest-first (Finnhub returns newest-first).
        const surprises = await getEarningsSurprises(symbol);
        const surpriseHistoryPct = surprises
          .map((s) => s.surprisePercent)
          .filter((v): v is number => v != null && Number.isFinite(v));
        const latestSurprisePct = surpriseHistoryPct.length ? surpriseHistoryPct[0] : null;

        const [tickerRet, benchmarkRet] = await Promise.all([
          getWindowReturn(symbol, DECLINE_WINDOW_DAYS),
          benchmarkReturn(pos.sector),
        ]);

        const hist = await getHistoricalValuation(symbol);

        // The reaction window costs a Finnhub calendar call + 2 market-data calls,
        // so only measure it when a miss actually needs explaining.
        let earningsReactionExcessPp: number | null = null;
        if (latestSurprisePct != null && latestSurprisePct < 0) {
          earningsReactionExcessPp = await getReportDateReactionExcess(symbol, benchmarkSymbol);
        }

        const decision = evaluateBounceBack({
          revenueGrowthTTM: metrics.revenueGrowthTTM,
          surpriseHistoryPct,
          earningsReactionExcessPp,
          tickerRet,
          benchmarkRet,
          peCurrent: metrics.pe,
          peAvg: hist.avgPE,
          pbCurrent: metrics.priceToBook,
          pbAvg: hist.avgPB,
          years: hist.years,
        });

        if (!decision) return;

        // Telemetry: a material miss we could NOT corroborate with a market
        // reaction (usually because the report predates the ~6-week calendar
        // retention window) is kept — magnitude-only. Log it so the degradation
        // is visible in prod rather than silent.
        if (decision.materiality.missIsMaterial && decision.materiality.reactionExcessPp == null) {
          console.log(
            `[noticed] bounce-back: ${symbol} kept on a magnitude-only miss read ` +
              `(report date outside the earnings-calendar window — reaction unmeasurable)`,
          );
        }

        // (e) historical-reversion evidence — computed only for names that
        // already qualify (each lookup costs a 5y daily candle fetch).
        const historical = await getHistoricalReversion(symbol, tickerRet as number);

        candidates.push({
          symbol,
          discountType: decision.discountType,
          discountPct: decision.discountPct,
          peCurrent: metrics.pe,
          peAvg: hist.avgPE,
          pbCurrent: metrics.priceToBook,
          pbAvg: hist.avgPB,
          tickerRet: tickerRet as number,
          benchmarkRet: benchmarkRet as number,
          benchmarkSymbol,
          years: hist.years,
          materiality: decision.materiality,
          historical,
        });
      } catch (err: any) {
        console.warn(`[noticed] Bounce-back check failed for ${symbol}:`, err?.message || err);
      }
    }),
  );

  // v1: concurrent-active cap (4) instead of the weekly single-fire selector.
  const { fire, keepAlive } = selectBounceBackCandidates(candidates, existingKeys);

  for (const c of fire) {
    triggers.push(buildBounceBackTrigger(c));
    console.log(
      `[noticed] Bounce-back: ${c.symbol} — ${Math.round(c.discountPct)}% below ${c.discountType === 'pe' ? 'P/E' : 'P/B'} norm` +
        (c.historical?.sufficient ? ` (historical reversion n=${c.historical.sample})` : ''),
    );
  }
  for (const c of keepAlive) {
    triggers.push(buildBounceBackTrigger(c));
  }
  if (fire.length > 0 || keepAlive.length > 0) {
    console.log(
      `[noticed] Bounce-back pass: ${fire.length} new (cap ${MAX_CONCURRENT_ACTIVE}), ${keepAlive.length} kept alive`,
    );
  }

  return triggers;
}
