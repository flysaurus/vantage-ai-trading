// ─── Server-side Finnhub quote enrichment ─────────────────
// SnapTrade does NOT expose any intraday day-gain field on its position
// objects (only `open_pnl` — total unrealized P&L). The fields the code
// previously read (`day_gain` / `day_change`) simply do not exist, which is
// why "Today" was permanently $0.00 everywhere.
//
// This module back-fills "Today" from Finnhub quotes — the SAME source the
// Market Overview (SPY/QQQ/DIA/IWM) and basket cards already use — so all
// three "Today" figures (hero, position, basket) derive from one live feed.
//
//   day change ($) = units × (current − previousClose)
//   day change (%) = (current − previousClose) / previousClose × 100

export interface FinnhubQuote {
  c: number;  // current price
  pc: number; // previous close
  d: number;  // Finnhub-provided day change ($) — fallback only
  dp: number; // Finnhub-provided day change (%) — fallback only
}

// Module-level per-symbol TTL cache so the account route, positions route,
// basket refresh, and Market Overview don't each re-fetch the same symbol and
// trip Finnhub's free-tier rate limit (60 req/min).
const QUOTE_CACHE_TTL_MS = 15_000;
const quoteCache = new Map<string, { at: number; quote: FinnhubQuote }>();

function cachedQuote(symbol: string): FinnhubQuote | null {
  const hit = quoteCache.get(symbol);
  if (!hit) return null;
  if (Date.now() - hit.at >= QUOTE_CACHE_TTL_MS) {
    quoteCache.delete(symbol);
    return null;
  }
  return hit.quote;
}

/** Fetch quotes for a set of symbols. Returns a symbol → quote map (missing/errored symbols omitted). */
export async function fetchFinnhubQuotes(
  symbols: string[],
): Promise<Record<string, FinnhubQuote>> {
  const token = process.env.FINNHUB_IO_API_KEY;
  const unique = [...new Set((symbols || []).map((s) => (s || '').trim().toUpperCase()).filter(Boolean))];
  if (!token || unique.length === 0) return {};

  const map: Record<string, FinnhubQuote> = {};
  const missing: string[] = [];
  for (const symbol of unique) {
    const hit = cachedQuote(symbol);
    if (hit) map[symbol] = hit;
    else missing.push(symbol);
  }

  if (missing.length === 0) return map;

  const settled = await Promise.allSettled(
    missing.map(async (symbol) => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) return null;
        const data = await res.json();
        return { symbol, data };
      } catch {
        return null;
      }
    }),
  );

  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const { symbol, data } = r.value;
    const quote: FinnhubQuote = {
      c: Number(data?.c) || 0,
      pc: Number(data?.pc) || 0,
      d: Number(data?.d) || 0,
      dp: Number(data?.dp) || 0,
    };
    quoteCache.set(symbol, { at: Date.now(), quote });
    map[symbol] = quote;
  }
  return map;
}

/**
 * Position-level day change (dollars + percent) from a Finnhub quote.
 * Prefers (current − previousClose); falls back to Finnhub's own `d`/`dp`,
 * then to 0 when no usable quote exists (market closed / symbol unknown).
 */
export function positionDayChange(
  units: number,
  quote?: FinnhubQuote | null,
): { dayChange: number; dayChangePct: number } {
  const c = quote?.c || 0;
  const pc = quote?.pc || 0;
  if (c > 0 && pc > 0) {
    const perUnit = c - pc;
    return { dayChange: (units || 0) * perUnit, dayChangePct: (perUnit / pc) * 100 };
  }
  if (quote && (quote.d !== 0 || quote.dp !== 0)) {
    return { dayChange: (units || 0) * quote.d, dayChangePct: quote.dp };
  }
  return { dayChange: 0, dayChangePct: 0 };
}
