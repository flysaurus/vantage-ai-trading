// ─── Portfolio value series (single source of truth) ─────────────
// Weighted portfolio-value time series: N-symbol candle fetches
// (Finnhub → Yahoo fallback) folded into one value-per-timestamp series.
//
// Extracted verbatim out of `app/api/portfolio/chart/route.ts` so the route
// and the chat chart resolver share ONE implementation — a chart rendered in
// chat must be the same number the Portfolio screen shows, never a re-derivation.
//
// Server-side response cache: the series recomputes a weighted value series for
// EVERY position on EVERY request, so repeated range changes / warm re-mounts
// would re-fetch the whole universe. Cache the final point series keyed by a
// hash of positions + range + cash with a short TTL. The series only truly
// changes as the market ticks, so 60s is safe.

const FINNHUB_KEY = process.env.FINNHUB_IO_API_KEY;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const chartCache = new Map<string, { expiresAt: number; payload: ValueSeriesResult }>();
const CHART_CACHE_TTL_MS = 60_000;

export type ChartRange = '1D' | '1W' | '1M' | 'YTD' | 'ALL';

export interface ValueSeriesPosition {
  symbol: string;
  shares: number;
  buyDate?: string;
  avgCost?: number;
  totalCost?: number;
}

export interface ValueSeriesPoint {
  timestamp: number;
  value: number;
}

export interface ValueSeriesResult {
  points: ValueSeriesPoint[];
  error?: string;
}

interface CandleResult {
  timestamps: number[];
  map: Record<number, number>;
}

export const CHART_RANGES: ChartRange[] = ['1D', '1W', '1M', 'YTD', 'ALL'];

export function isChartRange(value: unknown): value is ChartRange {
  return typeof value === 'string' && (CHART_RANGES as string[]).includes(value);
}

function makeChartCacheKey(
  positions: ValueSeriesPosition[],
  cashBalance: number,
  range: ChartRange,
): string {
  const sig = positions
    .map((p) => `${p.symbol}:${p.shares}:${p.avgCost ?? 0}:${p.totalCost ?? 0}`)
    .sort()
    .join('|');
  return `${range}|${Math.round(cashBalance * 100) / 100}|${sig}`;
}

// ─── Range params ──────────────────────────────────────

function getRangeParams(range: ChartRange) {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date();

  switch (range) {
    case '1D': {
      const open = new Date();
      open.setHours(9, 30, 0, 0);
      // If market hasn't opened yet today, use yesterday
      if (open.getTime() > Date.now()) {
        open.setDate(open.getDate() - 1);
        // Skip weekends
        if (open.getDay() === 6) open.setDate(open.getDate() - 1);
        if (open.getDay() === 0) open.setDate(open.getDate() - 2);
      }
      const close = new Date(open);
      close.setHours(16, 0, 0, 0);
      return {
        from: Math.floor(open.getTime() / 1000),
        to: Math.min(Math.floor(close.getTime() / 1000), Math.floor(Date.now() / 1000)),
        resolution: '60',
      };
    }
    case '1W':
      return {
        from: now - 7 * 86400,
        to: now,
        resolution: '60',
      };
    case '1M':
      return {
        from: now - 30 * 86400,
        to: now,
        resolution: '60',
      };
    case 'YTD': {
      const jan1 = new Date(today.getFullYear(), 0, 1);
      return {
        from: Math.floor(jan1.getTime() / 1000),
        to: now,
        resolution: 'D',
      };
    }
    case 'ALL':
      return {
        from: Math.floor(new Date('2024-01-08').getTime() / 1000),
        to: now,
        resolution: 'W',
      };
  }
}

// ─── Fetch Yahoo Finance candles (fallback) ───────────────

async function fetchYahooCandles(
  symbol: string,
  from: number,
  to: number,
  resolution: string,
): Promise<CandleResult | null> {
  // Map our resolution to Yahoo interval
  const intervalMap: Record<string, string> = {
    '5': '5m',
    '60': '1h',
    'D': '1d',
    'W': '1wk',
  };
  const interval = intervalMap[resolution] || '1d';

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${from}&period2=${to}&interval=${interval}&events=history`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Vantage/1.0' },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp as number[];
    const quotes = result.indicators?.quote?.[0];
    const closes = quotes?.close as (number | null)[];
    if (!timestamps || !closes) return null;

    console.log(`[Chart] Yahoo ${symbol}: ${timestamps.length} points (interval=${interval})`);

    const map: Record<number, number> = {};
    timestamps.forEach((t: number, i: number) => {
      if (closes[i] != null) {
        map[t] = closes[i];
      }
    });

    return { timestamps, map };
  } catch {
    return null;
  }
}

// ─── 1D fallback using quote API ──────────────────────────

async function build1DQuoteFallback(
  positions: ValueSeriesPosition[],
  cashBalance: number,
  from: number,
  to: number,
): Promise<ValueSeriesResult> {
  try {
    // Fetch current quotes for all symbols
    const quoteResults = await Promise.allSettled(
      positions.map(async (p) => {
        const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(p.symbol)}&token=${FINNHUB_KEY}`;
        const res = await fetch(url, { next: { revalidate: 30 } });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          symbol: p.symbol,
          current: (data.c ?? data.pc ?? 0) as number,
          prevClose: (data.pc ?? data.c ?? 0) as number,
        };
      }),
    );

    // Build 2-point chart: market open → current (or prevClose → current)
    const now = Math.floor(Date.now() / 1000);
    const openTs = from;

    const computeValue = (useOpen: boolean) => {
      let value = cashBalance;
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const buyTime = pos.buyDate ? Math.floor(new Date(pos.buyDate).getTime() / 1000) : 0;
        const buyCost = pos.totalCost ?? pos.shares * (pos.avgCost ?? 0);

        if (openTs < buyTime) {
          value += buyCost;
          continue;
        }

        const quote = quoteResults[i];
        if (quote.status === 'fulfilled' && quote.value) {
          const price = useOpen ? quote.value.prevClose : quote.value.current;
          if (price > 0) {
            value += pos.shares * price;
            continue;
          }
        }
        value += pos.avgCost ? pos.shares * pos.avgCost : 0;
      }
      return Math.round(value * 100) / 100;
    };

    const points: ValueSeriesPoint[] = [
      { timestamp: openTs, value: computeValue(true) },
    ];

    if (now > openTs + 60) {
      points.push({ timestamp: now, value: computeValue(false) });
    }

    return { points };
  } catch {
    return { points: [], error: 'No candle data available' };
  }
}

// ─── Fetch Finnhub candles ──────────────────────────────

async function fetchFinnhubCandles(
  symbol: string,
  from: number,
  to: number,
  resolution: string,
): Promise<CandleResult | null> {
  const url =
    `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_KEY}`;

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    const data = await res.json();

    console.log(`[Chart] Finnhub ${symbol}: s=${data.s} t=${data.t?.length || 0} c=${data.c?.length || 0} r=${resolution}`, data.error ? `err=${data.error}` : '');

    if (data.s !== 'ok' || !data.t || !data.c) return null;

    const map: Record<number, number> = {};
    data.t.forEach((t: number, i: number) => {
      map[t] = data.c[i];
    });

    return { timestamps: data.t, map };
  } catch {
    return null;
  }
}

// ─── Public: weighted portfolio value series ────────────

/**
 * Build the weighted portfolio-value series for `range`.
 *
 * Positions that did not exist yet at a timestamp contribute their COST as cash
 * (never a price out of thin air); a missing candle falls back to avgCost.
 * Cached 60s keyed by positions + cash + range.
 */
export async function buildPortfolioValueSeries(
  positions: ValueSeriesPosition[],
  cashBalance: number,
  range: ChartRange,
): Promise<ValueSeriesResult> {
  if (positions.length === 0) return { points: [] };

  const cacheKey = makeChartCacheKey(positions, cashBalance, range);
  const cached = chartCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[Chart] Cache HIT: ${positions.length} positions, range=${range}`);
    return cached.payload;
  }

  const respond = (payload: ValueSeriesResult): ValueSeriesResult => {
    chartCache.set(cacheKey, { expiresAt: Date.now() + CHART_CACHE_TTL_MS, payload });
    return payload;
  };

  const { from, to, resolution } = getRangeParams(range);

  // Fetch candles for all symbols in parallel (Finnhub → Yahoo fallback)
  const candleResults = await Promise.allSettled(
    positions.map(async (p) => {
      const result = await fetchFinnhubCandles(p.symbol, from, to, resolution);
      if (result) return result;
      // Fallback to Yahoo Finance
      console.log(`[Chart] Finnhub failed for ${p.symbol}, trying Yahoo Finance`);
      return fetchYahooCandles(p.symbol, from, to, resolution);
    }),
  );

  // Get reference timestamps from first successful result
  let refTimestamps: number[] = [];
  for (const result of candleResults) {
    if (result.status === 'fulfilled' && result.value) {
      refTimestamps = result.value.timestamps;
      break;
    }
  }

  if (refTimestamps.length === 0) {
    // No candles at all — for 1D, fall back to quote-based estimate
    if (range === '1D') {
      return respond(await build1DQuoteFallback(positions, cashBalance, from, to));
    }
    return respond({ points: [], error: 'No candle data available' });
  }

  // Build candle maps keyed by symbol
  const candleMaps: Record<string, Record<number, number>> = {};
  candleResults.forEach((result, i) => {
    const sym = positions[i].symbol;
    if (result.status === 'fulfilled' && result.value) {
      candleMaps[sym] = result.value.map;
    } else {
      candleMaps[sym] = {};
    }
  });

  // Calculate portfolio value at each reference timestamp
  const points = refTimestamps.map((t) => {
    let value = cashBalance;

    for (const pos of positions) {
      const buyTime = pos.buyDate
        ? Math.floor(new Date(pos.buyDate).getTime() / 1000)
        : 0;

      if (t < buyTime) {
        // Position didn't exist yet — add back its cost as cash
        value += pos.totalCost ?? (pos.shares * (pos.avgCost ?? 0));
      } else {
        const price = candleMaps[pos.symbol]?.[t];
        if (typeof price === 'number') {
          value += pos.shares * price;
        } else {
          // Missing candle — use avgCost as fallback
          value += pos.shares * (pos.avgCost ?? 0);
        }
      }
    }

    return { timestamp: t, value: Math.round(value * 100) / 100 };
  });

  return respond({ points });
}
