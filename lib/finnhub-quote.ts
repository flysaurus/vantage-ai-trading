// ─── Server-side quote enrichment for broker "Today" P&L ─────────────────
// SnapTrade does NOT expose any intraday day-gain field on its position
// objects (only `open_pnl` — total unrealized P&L). The fields the code
// previously read (`day_gain` / `day_change`) simply do not exist, which is
// why "Today" was permanently $0.00 everywhere.
//
// This module back-fills "Today" from live quotes — the SAME source the Market
// Overview (SPY/QQQ/DIA/IWM) and basket cards already use — so all three
// "Today" figures (hero, position, basket) derive from one live feed.
//
//   day change ($) = units × (current − previousClose)
//   day change (%) = (current − previousClose) / previousClose × 100
//
// ─── Why the multi-source chain + limiter ────────────────────────────────
// A Holdings page load fans out 25+ symbols across the account route, the
// positions route and Market Overview. Firing one unconstrained parallel
// Finnhub request per symbol instantly trips the free-tier cap (60 req/min):
// a measured 40-symbol burst returned 12×200 + 28×429 in <500 ms. The old
// code silently skipped every non-200 (`if (!res.ok) return null`), so those
// symbols were simply *missing* from the quote map — and `positionDayChange`
// then fabricated a flat day ({dayChange: 0}) for each, forcing the hero to
// render "Today $0.00 (+0.0%)".
//
// Fixes here:
//   1. Bounded concurrency (≤6 in flight) so a cold load cannot stampede.
//   2. A 429 retry with backoff that honours `Retry-After`.
//   3. A real fallback chain Finnhub → Alpaca → Yahoo (same chain as
//      `getBatchQuotes()` in lib/market-data.ts) so a throttled Finnhub
//      falls through to a source that still answers.
//   4. `positionDayChange` returns an explicit *unavailable* result (null)
//      when no usable quote exists — it never fabricates a flat $0.00 day.
//      A genuine flat day (quote exists, change is 0) still returns 0.

import { alpacaQuote, yahooQuote, type Quote } from '@/lib/market-data';

export interface FinnhubQuote {
  c: number;  // current price
  pc: number; // previous close
  d: number;  // day change ($) — fallback only
  dp: number; // day change (%) — fallback only
}

/**
 * Result of a position day-change computation.
 * `null` on either field means "unavailable" (no usable quote exists) and MUST
 * render as an explicit unavailable marker — NOT as a fabricated $0.00 / 0.00%.
 * A real zero (quote exists and the position is genuinely flat) is preserved as
 * a number, so callers can tell quote-missing apart from quote-flat.
 */
export interface DayChangeResult {
  dayChange: number | null;
  dayChangePct: number | null;
}

// ─── Config ──────────────────────────────────────────────

// 60s TTL: long enough that a single page load cannot re-trip the free-tier
// cap (the old 15s TTL meant a cold cache every few interactions), short
// enough that intraday figures stay fresh.
const QUOTE_CACHE_TTL_MS = 60_000;
const MAX_INFLIGHT = 6;
const MAX_FINNHUB_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 400;
// If Finnhub asks us to wait longer than this, retrying inside a page load is
// pointless — fall through to the next source immediately instead of stalling.
const MAX_BACKOFF_MS = 2_000;

type CacheEntry = { at: number; quote: FinnhubQuote | null };

// Module-level per-symbol TTL cache. An entry may hold `quote: null` to record
// a *transiently unavailable* symbol and stop it being re-hammered — without
// ever overwriting a previously-cached real quote (see fetchFinnhubQuotes).
const quoteCache = new Map<string, CacheEntry>();

function cacheGet(symbol: string): { found: boolean; quote: FinnhubQuote | null } {
  const hit = quoteCache.get(symbol);
  if (!hit) return { found: false, quote: null };
  if (Date.now() - hit.at >= QUOTE_CACHE_TTL_MS) {
    quoteCache.delete(symbol);
    return { found: false, quote: null };
  }
  return { found: true, quote: hit.quote };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse a Retry-After header (seconds or HTTP-date) → milliseconds, capped. */
function parseRetryAfterMs(header: string | null): number {
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return 0;
}

/** Run `fn` over `items` with at most `limit` promises in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Normalise a generic Quote (Alpaca/Yahoo) into the Finnhub-shaped quote. */
function toFinnhubQuote(q: Quote | null): FinnhubQuote | null {
  if (!q || !(q.price > 0)) return null;
  return {
    c: q.price,
    pc: q.previousClose || 0,
    d: q.change ?? 0,
    dp: q.changePercent ?? 0,
  };
}

/** Single Finnhub quote with bounded 429 retry that honours Retry-After. */
async function finnhubQuoteWithRetry(
  symbol: string,
  token: string,
): Promise<FinnhubQuote | null> {
  for (let attempt = 0; attempt < MAX_FINNHUB_ATTEMPTS; attempt++) {
    const last = attempt === MAX_FINNHUB_ATTEMPTS - 1;
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.status === 429) {
        const waitMs = parseRetryAfterMs(res.headers.get('retry-after')) || DEFAULT_BACKOFF_MS;
        // Only wait+retry when the ask is short; otherwise fall through now.
        if (!last && waitMs <= MAX_BACKOFF_MS) {
          await sleep(waitMs);
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const c = Number(data?.c) || 0;
      if (!(c > 0)) return null; // all-zero payload = unknown symbol
      return {
        c,
        pc: Number(data?.pc) || 0,
        d: Number(data?.d) || 0,
        dp: Number(data?.dp) || 0,
      };
    } catch {
      if (!last) {
        await sleep(DEFAULT_BACKOFF_MS * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

interface SourceCounts {
  finnhub: number;
  alpaca: number;
  yahoo: number;
  unavailable: number;
}

/** Resolve one symbol through the Finnhub → Alpaca → Yahoo chain. */
async function resolveQuote(
  symbol: string,
  token: string,
  counts: SourceCounts,
): Promise<FinnhubQuote | null> {
  if (token) {
    const fh = await finnhubQuoteWithRetry(symbol, token);
    if (fh) {
      counts.finnhub++;
      return fh;
    }
  }
  const ap = toFinnhubQuote(await alpacaQuote(symbol));
  if (ap) {
    counts.alpaca++;
    return ap;
  }
  const yh = toFinnhubQuote(await yahooQuote(symbol));
  if (yh) {
    counts.yahoo++;
    return yh;
  }
  counts.unavailable++;
  return null;
}

/**
 * Fetch quotes for a set of symbols.
 *
 * Returns a symbol → quote map; symbols that could not be resolved on ANY
 * source are omitted (callers treat the absence as "unavailable" — never as a
 * flat day). Resolution runs at ≤6 in flight with a 429-aware retry/backoff and
 * a Finnhub → Alpaca → Yahoo fallback chain.
 */
export async function fetchFinnhubQuotes(
  symbols: string[],
): Promise<Record<string, FinnhubQuote>> {
  const token = process.env.FINNHUB_IO_API_KEY || '';
  const unique = [...new Set((symbols || []).map((s) => (s || '').trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return {};

  const map: Record<string, FinnhubQuote> = {};
  const toFetch: string[] = [];
  for (const symbol of unique) {
    const hit = cacheGet(symbol);
    if (!hit.found) {
      toFetch.push(symbol);
    } else if (hit.quote) {
      map[symbol] = hit.quote; // cached unavailable (null) stays omitted
    }
  }

  if (toFetch.length === 0) return map;

  const counts: SourceCounts = { finnhub: 0, alpaca: 0, yahoo: 0, unavailable: 0 };
  const resolved = await mapLimit(toFetch, MAX_INFLIGHT, (sym) => resolveQuote(sym, token, counts));

  toFetch.forEach((symbol, i) => {
    const quote = resolved[i];
    // Cache the outcome — including the unavailable (null) state. We only ever
    // write here for symbols that were NOT already cached, so this can never
    // overwrite a real cached quote with a stale unavailable marker.
    quoteCache.set(symbol, { at: Date.now(), quote });
    if (quote) map[symbol] = quote;
  });

  console.log(
    `[finnhub-quote] resolved ${toFetch.length} symbols — finnhub=${counts.finnhub} alpaca=${counts.alpaca} yahoo=${counts.yahoo} unavailable=${counts.unavailable}`,
  );
  return map;
}

/**
 * Position-level day change (dollars + percent) from a quote.
 *
 * Prefers (current − previousClose); falls back to the source's own `d`/`dp`.
 * Returns `{ dayChange: null, dayChangePct: null }` when NO usable quote exists
 * — this is an explicit "unavailable", so callers render "—" instead of a
 * fabricated flat $0.00 / 0.00%.
 *
 * A genuine flat day (a quote DOES exist and the change happens to be 0) still
 * returns numeric 0 — the missing-vs-flat distinction is preserved.
 */
export function positionDayChange(
  units: number,
  quote?: FinnhubQuote | null,
): DayChangeResult {
  if (quote) {
    const c = Number(quote.c) || 0;
    const pc = Number(quote.pc) || 0;
    if (c > 0 && pc > 0) {
      const perUnit = c - pc;
      return { dayChange: (units || 0) * perUnit, dayChangePct: (perUnit / pc) * 100 };
    }
    if (quote.d !== 0 || quote.dp !== 0) {
      return { dayChange: (units || 0) * quote.d, dayChangePct: quote.dp };
    }
  }
  // No usable quote → unavailable. NEVER fabricate a flat day.
  return { dayChange: null, dayChangePct: null };
}
