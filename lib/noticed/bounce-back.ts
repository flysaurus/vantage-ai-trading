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
 *   (a) Fundamentals intact — TTM revenue not declining AND no latest-earnings
 *       miss (a miss = fundamentals deteriorated, disqualified).
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
 *
 * Frequency: at most ONE bounce-back notice per user per week (system-wide).
 * Among qualifying tickers we surface only the single most-discounted one and
 * queue the rest for later weeks by permanently excluding already-fired symbols
 * (`previouslyFiredSymbols`). No style-gating — fires the same regardless of
 * investor_style.
 *
 * Deterministic firing path (keyword/data thresholds only — no LLM in the
 * firing decision). The LLM only rewords the copy, which is already
 * tone-compliant, so the budget-exhausted fallback carries the same voice.
 *
 * Reuses [ACTION:REVIEW_POSITION:TICKER] + ActionButton — no new UI component.
 */

import type { NoticedRuleInput, NoticedTrigger } from './engine';
import { getFinancialMetrics, getEarningsSurprises } from '@/lib/finnhub';
import { getCandles } from '@/lib/market-data';

// ── Config ──
const DECLINE_WINDOW_DAYS = 90;   // ~90-day window for filter (b)
const MIN_DECLINE_PCT = 10;       // ticker must be down at least this much
const MAX_UNDERPERFORM_PP = 10;   // ticker may trail benchmark by at most this many pp
const DISCOUNT_THRESHOLD = 0.2;   // ≥20% below own historical average (filter c)
const MIN_YEARS = 2;              // need ≥2 annual valuation points for a norm
const MAX_SYMBOLS = 10;           // top holdings by market value (same fan-out as event-impact)

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
}

/** Pre-fetched inputs to the pure decision function (testable without network). */
export interface BounceBackData {
  revenueGrowthTTM: number | null;
  latestSurprisePct: number | null; // null = no surprise data (lenient)
  tickerRet: number | null;
  benchmarkRet: number | null;
  peCurrent: number | null;
  peAvg: number | null;
  pbCurrent: number | null;
  pbAvg: number | null;
  years: number;
}

// ── Pure decision: the 4-filter conjunction (no I/O) ──
export function evaluateBounceBack(d: BounceBackData): {
  discountType: 'pe' | 'pb';
  discountPct: number;
} | null {
  // (a) Fundamentals intact — revenue must be present and not declining;
  //     a latest-earnings miss (negative surprise) disqualifies.
  if (d.revenueGrowthTTM == null || d.revenueGrowthTTM < 0) return null;
  if (d.latestSurprisePct != null && d.latestSurprisePct < 0) return null;

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
      return { discountType: 'pe', discountPct: Math.round(discountPct * 100) / 100 };
    }
  }
  if (d.pbCurrent != null && d.pbCurrent > 0 && d.pbAvg != null && d.pbAvg > 0) {
    const discountPct = (1 - d.pbCurrent / d.pbAvg) * 100;
    if (discountPct >= DISCOUNT_THRESHOLD * 100 - 1e-9) {
      return { discountType: 'pb', discountPct: Math.round(discountPct * 100) / 100 };
    }
  }

  return null;
}

// ── Pure selection: one-new-per-week cap + keep-alive persistence ──
export function selectWeeklyBounceBack(
  candidates: BounceCandidate[],
  previouslyFiredSymbols: Set<string>,
  activeKeys: Set<string>,
): { fire: BounceCandidate | null; keepAlive: BounceCandidate[] } {
  // New candidates = qualifying tickers we haven't nudged yet. Surface only the
  // single most-discounted one; the rest are reconsidered in later weeks.
  const fresh = candidates.filter((c) => !previouslyFiredSymbols.has(c.symbol));
  fresh.sort((a, b) => b.discountPct - a.discountPct);
  const fire = fresh[0] ?? null;

  // Keep-alive = already-fired symbols that STILL qualify and whose card is
  // currently active. Returning their key keeps the card in the firing set so
  // the pipeline's stale-resolve step doesn't dissolve it a day later; the
  // pipeline's trulyNew filter skips them (already active), so no re-fire.
  const keepAlive = candidates.filter(
    (c) => previouslyFiredSymbols.has(c.symbol) && activeKeys.has(`BOUNCE_${c.symbol}`),
  );

  return { fire, keepAlive };
}

// ── Pure trigger builder (tone-compliant deterministic copy) ──
export function buildBounceBackTrigger(c: BounceCandidate): NoticedTrigger {
  const valuation =
    c.discountType === 'pe'
      ? `P/E of ${c.peCurrent!.toFixed(1)} vs its own ${c.years}-year average of ${c.peAvg!.toFixed(1)}`
      : `P/B of ${c.pbCurrent!.toFixed(2)} vs its own ${c.years}-year average of ${c.pbAvg!.toFixed(2)}`;

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
    },
    follow_up: `Want to review ${c.symbol}?`,
    context:
      `${c.symbol} is a quality position trading at a temporary discount. ` +
      `Fundamentals are intact — revenue is still growing and the latest quarter didn't miss estimates. ` +
      `The recent ~${DECLINE_WINDOW_DAYS}-day pullback (${c.tickerRet.toFixed(1)}%) tracked the broader ` +
      `${c.benchmarkSymbol} move (${c.benchmarkRet.toFixed(1)}%) rather than a company-specific problem. ` +
      `It now trades at a ${valuation} (about ${Math.round(c.discountPct)}% below). ` +
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

// ── Main finder ──
export async function findBounceBackTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
  reviewEventSymbols: Set<string>,
  previouslyFiredSymbols: Set<string>,
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

        // (a) latest-earnings miss check (Finnhub surprises are newest-first).
        const surprises = await getEarningsSurprises(symbol);
        const latest = surprises[0];
        const latestSurprisePct =
          latest && latest.surprisePercent != null ? latest.surprisePercent : null;

        const [tickerRet, benchmarkRet] = await Promise.all([
          getWindowReturn(symbol, DECLINE_WINDOW_DAYS),
          benchmarkReturn(pos.sector),
        ]);

        const hist = await getHistoricalValuation(symbol);

        const decision = evaluateBounceBack({
          revenueGrowthTTM: metrics.revenueGrowthTTM,
          latestSurprisePct,
          tickerRet,
          benchmarkRet,
          peCurrent: metrics.pe,
          peAvg: hist.avgPE,
          pbCurrent: metrics.priceToBook,
          pbAvg: hist.avgPB,
          years: hist.years,
        });

        if (!decision) return;

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
        });
      } catch (err: any) {
        console.warn(`[noticed] Bounce-back check failed for ${symbol}:`, err?.message || err);
      }
    }),
  );

  const { fire, keepAlive } = selectWeeklyBounceBack(
    candidates,
    previouslyFiredSymbols,
    existingKeys,
  );

  if (fire) {
    triggers.push(buildBounceBackTrigger(fire));
    console.log(
      `[noticed] Bounce-back: ${fire.symbol} — ${Math.round(fire.discountPct)}% below ${fire.discountType === 'pe' ? 'P/E' : 'P/B'} norm`,
    );
  }
  for (const k of keepAlive) {
    triggers.push(buildBounceBackTrigger(k));
  }

  return triggers;
}
