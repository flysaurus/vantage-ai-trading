// ─── Market Data Service (Multi-Source with Fallback Chain) ──
//
// Sources (in priority order):
//   1. Finnhub.io     – real-time quotes, profiles, fundamentals (60 req/min free)
//   2. Alpaca Markets  – real-time quotes, bars, snapshots (API key required)
//   3. Yahoo Finance   – free, no key needed (last resort fallback)
//
// For quotes:            Finnhub → Alpaca → Yahoo
// For company profiles:  Finnhub → Yahoo (Alpaca lacks profile data)
// For candles (bars):    Alpaca → Yahoo → Finnhub
// For fundamentals:      Finnhub only
//
// Caching:
//   - 60s TTL during market hours (09:30-16:00 ET)
//   - 300s TTL outside market hours (after-hours, weekends, holidays)
//   - In-memory cache; cleared on server restart

import { isMarketOpen } from '@/lib/market-hours';

// ─── Types ────────────────────────────────────────────────────

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  high: number;
  low: number;
  open: number;
  volume?: number;
  high52w?: number;
  low52w?: number;
  source: 'finnhub' | 'alpaca' | 'yahoo';
  timestamp: number;
}

export interface CompanyProfile {
  ticker: string;
  name: string;
  industry: string;
  marketCap: number | null;
  exchange: string;
  logo: string;
  country: string;
  currency: string;
  ipo: string;
  phone: string;
  weburl: string;
  shareOutstanding: number | null;
  source: 'finnhub' | 'yahoo';
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundamentalMetrics {
  symbol: string;
  eps: number | null;
  pe: number | null;
  high52w: number | null;
  low52w: number | null;
  beta: number | null;
  dividendYield: number | null;
  dividendRate: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  numAnalysts: number | null;
  recommendation: string | null;
  nextEarningsDate: string | null;
  source: 'finnhub' | 'yahoo';
}

// ─── Config Keys ─────────────────────────────────────────────

function finnhubKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || null;
}

function alpacaKeys(): { keyId: string; secretKey: string } | null {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) return null;
  return { keyId, secretKey };
}

function alpacaIsLive(): boolean {
  return process.env.ALPACA_ENVIRONMENT === 'live';
}

// ══════════════════════════════════════════════════════════════
// SOURCE 1: FINNHUB
// ══════════════════════════════════════════════════════════════

async function finnhubQuote(symbol: string, timeout = 5000): Promise<Quote | null> {
  const key = finnhubKey();
  if (!key) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${key}`,
      { signal: AbortSignal.timeout(timeout) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.c === 0) return null; // all zeros = unknown symbol
    return {
      symbol: symbol.toUpperCase(),
      price: data.c,
      change: data.d ?? 0,
      changePercent: data.dp ?? 0,
      previousClose: data.pc,
      high: data.h ?? 0,
      low: data.l ?? 0,
      open: data.o ?? 0,
      // 52-week range is NOT available on Finnhub /quote — enriched separately via /stock/metric
      source: 'finnhub',
      timestamp: (data.t || 0) * 1000,
    };
  } catch {
    return null;
  }
}

async function finnhubProfile(symbol: string, timeout = 5000): Promise<CompanyProfile | null> {
  const key = finnhubKey();
  if (!key) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${key}`,
      { signal: AbortSignal.timeout(timeout) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ticker) return null;
    return {
      ticker: data.ticker,
      name: data.name || '',
      industry: data.finnhubIndustry || '',
      marketCap: data.marketCapitalization != null ? data.marketCapitalization * 1e6 : null,
      exchange: data.exchange || '',
      logo: data.logo || '',
      country: data.country || '',
      currency: data.currency || '',
      ipo: data.ipo || '',
      phone: data.phone || '',
      weburl: data.weburl || '',
      shareOutstanding: data.shareOutstanding != null ? data.shareOutstanding * 1e6 : null,
      source: 'finnhub',
    };
  } catch {
    return null;
  }
}

async function finnhubFundamentals(symbol: string, timeout = 5000): Promise<FundamentalMetrics | null> {
  const key = finnhubKey();
  if (!key) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol.toUpperCase())}&metric=all&token=${key}`,
      { signal: AbortSignal.timeout(timeout) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const m = data?.metric;
    if (!m) return null;
    return {
      symbol: symbol.toUpperCase(),
      eps: m.epsBasicExclExtraItemsTTM ?? null,
      pe: m.peBasicExclExtraTTM ?? null,
      high52w: m['52WeekHigh'] ?? null,
      low52w: m['52WeekLow'] ?? null,
      beta: m.beta ?? null,
      dividendYield: m.dividendYieldIndicatedAnnual ?? null,
      dividendRate: m.dividendPerShareAnnual ?? null,
      marketCap: m.marketCapitalization != null ? m.marketCapitalization * 1e6 : null,
      volume: null,
      avgVolume: null,
      dayHigh: null,
      dayLow: null,
      numAnalysts: null,
      recommendation: null,
      nextEarningsDate: null,
      source: 'finnhub' as const,
    };
  } catch {
    return null;
  }
}

async function finnhubCandles(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
  timeout = 5000
): Promise<Candle[] | null> {
  const key = finnhubKey();
  if (!key) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol.toUpperCase())}&resolution=${resolution}&from=${from}&to=${to}&token=${key}`,
      { signal: AbortSignal.timeout(timeout) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.s !== 'ok' || !data.t) return null;
    const candles: Candle[] = [];
    for (let i = 0; i < data.t.length; i++) {
      candles.push({
        timestamp: data.t[i] * 1000,
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i],
      });
    }
    return candles;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// SOURCE 2: ALPACA
// ══════════════════════════════════════════════════════════════

function alpacaDataUrl(): string {
  return alpacaIsLive()
    ? 'https://data.alpaca.markets'
    : 'https://data.alpaca.markets'; // paper and live use same data URL
}

function alpacaHeaders(): Record<string, string> | null {
  const keys = alpacaKeys();
  if (!keys) return null;
  return {
    'APCA-API-KEY-ID': keys.keyId,
    'APCA-API-SECRET-KEY': keys.secretKey,
  };
}

/**
 * Single-quote from Alpaca via snapshot (richer than /quotes/latest).
 */
async function alpacaQuote(symbol: string, timeout = 5000): Promise<Quote | null> {
  const headers = alpacaHeaders();
  if (!headers) return null;
  try {
    const snapUrl = `${alpacaDataUrl()}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbol.toUpperCase())}`;
    const res = await fetch(snapUrl, { headers, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const data = await res.json();
    const snap = data[symbol.toUpperCase()];
    if (!snap) return null;

    const trade = snap.latestTrade;
    const dailyBar = snap.dailyBar;
    const prevBar = snap.prevDailyBar;
    const price = trade?.p ?? dailyBar?.c ?? null;
    const prevClose = prevBar?.c ?? null;
    const change = price && prevClose ? +(price - prevClose).toFixed(2) : 0;
    const changePercent = change && prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;

    return {
      symbol: symbol.toUpperCase(),
      price: price || 0,
      change,
      changePercent,
      previousClose: prevClose || 0,
      high: dailyBar?.h || 0,
      low: dailyBar?.l || 0,
      open: dailyBar?.o || 0,
      volume: dailyBar?.v || 0,
      source: 'alpaca',
      timestamp: trade?.t ? new Date(trade.t).getTime() : Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Batch quotes from Alpaca snapshots (1 API call for up to ~50 symbols).
 */
async function alpacaBatchQuotes(symbols: string[], timeout = 8000): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();
  const headers = alpacaHeaders();
  if (!headers) return results;

  try {
    // Snapshots accepts comma-separated symbols
    const snapUrl = `${alpacaDataUrl()}/v2/stocks/snapshots?symbols=${symbols.join(',')}`;
    const res = await fetch(snapUrl, { headers, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return results;
    const data = await res.json();

    for (const sym of symbols) {
      const snap = data[sym];
      if (!snap) continue;
      const trade = snap.latestTrade;
      const dailyBar = snap.dailyBar;
      const prevBar = snap.prevDailyBar;
      const price = trade?.p ?? dailyBar?.c ?? null;
      const prevClose = prevBar?.c ?? null;
      const change = price && prevClose ? +(price - prevClose).toFixed(2) : 0;
      const changePercent = change && prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;

      results.set(sym, {
        symbol: sym,
        price: price || 0,
        change,
        changePercent,
        previousClose: prevClose || 0,
        high: dailyBar?.h || 0,
        low: dailyBar?.l || 0,
        open: dailyBar?.o || 0,
        volume: dailyBar?.v || 0,
        source: 'alpaca',
        timestamp: trade?.t ? new Date(trade.t).getTime() : Date.now(),
      });
    }
  } catch {
    // swallow — results will be empty
  }
  return results;
}

/**
 * Historical bars/candles from Alpaca.
 */
async function alpacaCandles(
  symbol: string,
  timeframe: string,
  start: string,
  end: string,
  limit = 100,
  timeout = 8000
): Promise<Candle[] | null> {
  const headers = alpacaHeaders();
  if (!headers) return null;
  try {
    const qs = new URLSearchParams({ timeframe, limit: String(limit) });
    if (start) qs.set('start', start);
    if (end) qs.set('end', end);
    const url = `${alpacaDataUrl()}/v2/stocks/${encodeURIComponent(symbol.toUpperCase())}/bars?${qs}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const raw = await res.json();
    const bars = raw.bars || [];
    return bars.map((b: any) => ({
      timestamp: new Date(b.t).getTime(),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }));
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// SOURCE 3: YAHOO FINANCE (free, no API key)
// ══════════════════════════════════════════════════════════════

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/** Normalize symbol for Yahoo Finance: BRK.B → BRK-B, BF.A → BF-A */
function yahooSymbol(symbol: string): string {
  return symbol.replace('.', '-');
}

/** Parse a single quote from Yahoo v8 chart meta + indicators. */
function parseYahooQuote(symbol: string, result: any): Quote | null {
  const meta = result?.meta;
  if (!meta || meta.regularMarketPrice == null) return null;

  const price = meta.regularMarketPrice;

  // Compute prev close from the second-to-last candle
  const quoteData = result?.indicators?.quote?.[0];
  const closes = quoteData?.close || [];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? price);
  const change = prevClose ? +(price - prevClose).toFixed(2) : 0;
  const changePercent = prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;

  // Find today's candle (the last one)
  const lastIdx = closes.length - 1;
  const todayOpen = quoteData?.open?.[lastIdx] ?? meta.regularMarketOpen ?? 0;
  const todayHigh = quoteData?.high?.[lastIdx] ?? meta.regularMarketDayHigh ?? 0;
  const todayLow = quoteData?.low?.[lastIdx] ?? meta.regularMarketDayLow ?? 0;

  return {
    symbol: (meta.symbol || symbol).toUpperCase(),
    price,
    change,
    changePercent,
    previousClose: prevClose || 0,
    high: todayHigh,
    low: todayLow,
    open: todayOpen,
    volume: meta.regularMarketVolume ?? quoteData?.volume?.[lastIdx] ?? 0,
    high52w: meta.fiftyTwoWeekHigh ?? undefined,
    low52w: meta.fiftyTwoWeekLow ?? undefined,
    source: 'yahoo',
    timestamp: Date.now(),
  };
}

async function yahooQuote(symbol: string, timeout = 5000): Promise<Quote | null> {
  try {
    const ySymbol = yahooSymbol(symbol.toUpperCase());
    const res = await fetch(
      `${YAHOO_CHART_BASE}/${encodeURIComponent(ySymbol)}?range=5d&interval=1d&includePrePost=false`,
      {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': YAHOO_UA, 'Accept': 'application/json' },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return parseYahooQuote(symbol, data?.chart?.result?.[0]);
  } catch {
    return null;
  }
}

async function yahooBatchQuotes(symbols: string[], timeout = 10000): Promise<Map<string, Quote>> {
  const results = new Map<string, Quote>();
  // Yahoo v8 chart doesn't support batch — fetch individually with concurrency
  const batchSize = 5;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(sym => yahooQuote(sym, timeout))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.set(r.value.symbol, r.value);
      }
    }
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  return results;
}

async function yahooProfile(symbol: string, timeout = 5000): Promise<CompanyProfile | null> {
  try {
    const ySymbol = yahooSymbol(symbol.toUpperCase());
    const res = await fetch(
      `${YAHOO_CHART_BASE}/${encodeURIComponent(ySymbol)}?range=1d&interval=1d&includePrePost=false`,
      {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': YAHOO_UA, 'Accept': 'application/json' },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    return {
      ticker: meta.symbol || symbol.toUpperCase(),
      name: meta.shortName || meta.longName || '',
      industry: meta.sector || meta.industry || '',
      marketCap: meta.marketCap ?? null,
      exchange: meta.exchangeName || meta.fullExchangeName || '',
      logo: '',
      country: meta.region || '',
      currency: meta.currency || 'USD',
      ipo: '',
      phone: '',
      weburl: '',
      shareOutstanding: meta.sharesOutstanding ?? null,
      source: 'yahoo',
    };
  } catch {
    return null;
  }
}

async function yahooCandles(
  symbol: string,
  range: string,
  interval: string,
  timeout = 8000
): Promise<Candle[] | null> {
  try {
    const ySymbol = yahooSymbol(symbol.toUpperCase());
    const res = await fetch(
      `${YAHOO_CHART_BASE}/${encodeURIComponent(ySymbol)}?range=${range}&interval=${interval}&includePrePost=false`,
      {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': YAHOO_UA, 'Accept': 'application/json' },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];
    if (!quote || !timestamps.length) return null;

    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      candles.push({
        timestamp: timestamps[i] * 1000,
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i] || 0,
      });
    }
    return candles;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API: FALLBACK CHAIN
// ══════════════════════════════════════════════════════════════

/**
 * Get a single stock quote.
 * Chain: Finnhub → Alpaca → Yahoo
 */
export async function getQuote(symbol: string): Promise<Quote | null> {
  // 1. Finnhub
  const fh = await finnhubQuote(symbol);
  if (fh && fh.price > 0) return fh;

  // 2. Alpaca
  const ap = await alpacaQuote(symbol);
  if (ap && ap.price > 0) return ap;

  // 3. Yahoo
  const yh = await yahooQuote(symbol);
  if (yh && yh.price > 0) return yh;

  return null;
}

/**
 * Get batch quotes for multiple symbols.
 * Chain: Finnhub → Alpaca → Yahoo
 *
 * Tries each source for the full batch, falling back for symbols
 * that didn't resolve. Final pass uses Yahoo.
 */
// ─── Quote Cache ─────────────────────────────────────────
// TTL: 60s during market hours, 300s outside
const _quoteCache = new Map<string, { data: Quote; timestamp: number }>();

function _cacheTtlMs(): number {
  return isMarketOpen() ? 60_000 : 300_000;
}

function _getCached(symbol: string): Quote | null {
  const entry = _quoteCache.get(symbol.toUpperCase());
  if (!entry) return null;
  if (Date.now() - entry.timestamp > _cacheTtlMs()) {
    _quoteCache.delete(symbol.toUpperCase());
    return null;
  }
  return entry.data;
}

function _setCache(symbol: string, data: Quote): void {
  _quoteCache.set(symbol.toUpperCase(), { data, timestamp: Date.now() });
}

export async function getBatchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  if (symbols.length === 0) return new Map();

  const remaining = new Set<string>();
  const results = new Map<string, Quote>();
  let cacheHits = 0;

  // Check cache first
  for (const sym of symbols) {
    const cached = _getCached(sym);
    if (cached) {
      results.set(sym.toUpperCase(), cached);
      cacheHits++;
    } else {
      remaining.add(sym.toUpperCase());
    }
  }

  if (cacheHits > 0) {
    console.log(`[quotes] cache hits: ${cacheHits}/${symbols.length} (TTL: ${_cacheTtlMs() / 1000}s)`);
  }

  if (remaining.size === 0) return results;

  const fetched = new Map<string, Quote>();

  // 1. Try Finnhub in concurrent batches (rate limit: 60/min)
  const fhKey = finnhubKey();
  if (fhKey && remaining.size > 0) {
    const batchSize = 10;
    const symArr = [...remaining];
    let fhResolved = 0;
    let fhFailed = 0;
    for (let i = 0; i < symArr.length; i += batchSize) {
      const batch = symArr.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(sym => finnhubQuote(sym, 5000))
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value && r.value.price > 0) {
          fetched.set(r.value.symbol, r.value);
          remaining.delete(r.value.symbol);
          fhResolved++;
        } else {
          fhFailed++;
        }
      }
      if (i + batchSize < symArr.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    console.log('[quotes] finnhub result: resolved=' + fhResolved + ' failed=' + fhFailed + ' remaining=' + remaining.size);
  } else {
    console.log('[quotes] finnhub: skipped (no key=' + !fhKey + ' remaining=' + (remaining.size === 0) + ')');
  }

  // 2. Try Alpaca for remaining
  if (remaining.size > 0) {
    const apResults = await alpacaBatchQuotes([...remaining]);
    let apResolved = 0;
    for (const [sym, quote] of apResults) {
      if (quote.price > 0) {
        fetched.set(sym, quote);
        remaining.delete(sym);
        apResolved++;
      }
    }
    console.log('[quotes] alpaca result: resolved=' + apResolved + ' remaining=' + remaining.size);
  } else {
    console.log('[quotes] alpaca: skipped (no remaining)');
  }

  // 3. Yahoo for any still remaining
  if (remaining.size > 0) {
    const yhResults = await yahooBatchQuotes([...remaining]);
    let yhResolved = 0;
    for (const [sym, quote] of yhResults) {
      if (quote.price > 0) {
        fetched.set(sym, quote);
        remaining.delete(sym);
        yhResolved++;
      }
    }
    console.log('[quotes] yahoo result: resolved=' + yhResolved + ' remaining=' + remaining.size);
  } else {
    console.log('[quotes] yahoo: skipped (no remaining)');
  }

  // 4. Enrich: fetch 52-week range for all resolved symbols
  //    Primary: Finnhub /stock/metric (fast, official)
  //    Fallback: Yahoo v8/chart meta (free, no key, always works)
  if (fetched.size > 0) {
    const symArr = [...fetched.keys()];
    let enriched = 0;
    let yahooFallback = 0;
    for (let i = 0; i < symArr.length; i++) {
      const sym = symArr[i];
      const q = fetched.get(sym)!;
      // Skip if quote already has valid 52-week range
      if (q.high52w != null && q.high52w > 0) continue;

      try {
        // Try Finnhub first (only if key available)
        if (fhKey) {
          const metric = await finnhubFundamentals(sym, 4000);
          if (metric?.high52w != null && metric.high52w > 0) {
            fetched.set(sym, { ...q, high52w: metric.high52w, low52w: metric.low52w ?? q.low52w });
            enriched++;
            continue;
          }
        }
        // Fallback: Yahoo 52-week range from v8/chart meta (always available)
        try {
          const ySymbol = yahooSymbol(sym);
          const yRes = await fetch(
            `${YAHOO_CHART_BASE}/${encodeURIComponent(ySymbol)}?range=1y&interval=1d&includePrePost=false`,
            { headers: { 'User-Agent': YAHOO_UA }, signal: AbortSignal.timeout(4000) }
          );
          if (yRes.ok) {
            const yData = await yRes.json();
            const yMeta = yData?.chart?.result?.[0]?.meta;
            if (yMeta?.fiftyTwoWeekHigh != null && yMeta.fiftyTwoWeekHigh > 0) {
              fetched.set(sym, {
                ...q,
                high52w: yMeta.fiftyTwoWeekHigh,
                low52w: yMeta.fiftyTwoWeekLow ?? 0,
              });
              yahooFallback++;
            }
          }
        } catch { /* keep quote as-is */ }
      } catch { /* non-critical — keep quote as-is */ }
      if (i < symArr.length - 1) await new Promise(r => setTimeout(r, 50));
    }
    console.log('[quotes] 52-week enrichment: finnhub=' + enriched + ' yahoo=' + yahooFallback + ' total=' + symArr.length);
  }

  // Merge fetched results into main results + update cache
  for (const [sym, quote] of fetched) {
    _setCache(sym, quote);
    results.set(sym, quote);
  }

  return results;
}

/**
 * Get a raw price number (convenience wrapper for simple price checks).
 */
export async function getPrice(symbol: string): Promise<number | null> {
  const q = await getQuote(symbol);
  return q?.price ?? null;
}

/**
 * Get company profile.
 * Chain: Finnhub → Yahoo
 */
export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const fh = await finnhubProfile(symbol);
  if (fh) return fh;
  return yahooProfile(symbol);
}

// ─── Company-name resolution (persisted-name source of truth) ──
// Resolves the full company/ETF name for a symbol ONCE and caches it in-memory
// for the process lifetime. Used at order-placement time (execute-trade /
// execute-basket) and by the one-time backfill so names are persisted onto the
// order record instead of being re-fetched on every render.
// Chain: Finnhub → Yahoo (Yahoo only as a fallback — fragile from Vercel IPs).

const _companyNameCache = new Map<string, string | null>();

/** Resolve the display name for a symbol, or null if unresolvable. */
export async function resolveCompanyName(symbol: string): Promise<string | null> {
  const s = symbol.toUpperCase();
  if (_companyNameCache.has(s)) return _companyNameCache.get(s)!;
  let name: string | null = null;
  try {
    const profile = await getCompanyProfile(s);
    if (profile?.name && profile.name !== s) name = profile.name;
  } catch {
    name = null;
  }
  _companyNameCache.set(s, name);
  return name;
}

/** Batch-resolve names (small batches — placement paths, backfill helper). */
export async function resolveCompanyNames(symbols: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean)));
  const results = await Promise.allSettled(unique.map((s) => resolveCompanyName(s)));
  unique.forEach((s, i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) out[s] = r.value;
  });
  return out;
}

// ─── Yahoo Crumb Auth (needed for v10/v11 quoteSummary) ─────

let yahooCrumb: { crumb: string; cookie: string; expires: number } | null = null;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  // Reuse cached crumb for up to 4 hours
  if (yahooCrumb && Date.now() < yahooCrumb.expires) {
    return { crumb: yahooCrumb.crumb, cookie: yahooCrumb.cookie };
  }

  try {
    // Step 1: Get cookie from fc.yahoo.com
    const cookieRes = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': YAHOO_UA },
      signal: AbortSignal.timeout(5000),
    });
    const setCookie = cookieRes.headers.get('set-cookie');
    if (!setCookie) return null;
    // Extract just the cookie name=value part (without attributes)
    const cookie = setCookie.split(';')[0];

    // Step 2: Get crumb using the cookie
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YAHOO_UA, 'Cookie': cookie },
      signal: AbortSignal.timeout(5000),
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 50) return null; // likely HTML error page

    yahooCrumb = { crumb, cookie, expires: Date.now() + 4 * 60 * 60 * 1000 };
    return { crumb, cookie };
  } catch {
    return null;
  }
}

/**
 * Yahoo Finance fundamentals via v10 quoteSummary.
 * Returns EPS, P/E, dividend yield, and analyst consensus.
 */
export async function yahooFundamentals(symbol: string): Promise<FundamentalMetrics | null> {
  const auth = await getYahooCrumb();
  if (!auth) return null;

  const ySymbol = yahooSymbol(symbol.toUpperCase());
  const modules = 'defaultKeyStatistics,summaryDetail,financialData,calendarEvents,recommendationTrend';

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ySymbol)}?modules=${modules}&crumb=${auth.crumb}`,
      {
        headers: { 'User-Agent': YAHOO_UA, 'Cookie': auth.cookie },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;

    const dks = result.defaultKeyStatistics || {};
    const sd = result.summaryDetail || {};
    const fd = result.financialData || {};
    const ce = result.calendarEvents || {};

    const getRaw = (obj: any, key: string): number | null => {
      const v = obj?.[key];
      if (v && typeof v === 'object' && 'raw' in v) return v.raw as number;
      return null;
    };

    const eps = getRaw(dks, 'trailingEps');
    const forwardEps = getRaw(dks, 'forwardEps');
    const trailingPE = getRaw(sd, 'trailingPE') ?? getRaw(dks, 'trailingPE');
    const forwardPE = getRaw(dks, 'forwardPE') ?? getRaw(sd, 'forwardPE');
    const dividendYield = getRaw(sd, 'dividendYield');
    const dividendRate = getRaw(sd, 'dividendRate');
    const recommendationKey = typeof fd?.recommendationKey === 'string' ? fd.recommendationKey : null;
    const numAnalysts = getRaw(fd, 'numberOfAnalystOpinions');
    
    // Part 5 — new fields
    const marketCap = getRaw(sd, 'marketCap') ?? getRaw(dks, 'marketCap');
    const volume = getRaw(sd, 'regularMarketVolume');
    const avgVolume = getRaw(sd, 'averageDailyVolume3Month') ?? getRaw(sd, 'averageVolume');
    const dayHigh = getRaw(sd, 'regularMarketDayHigh');
    const dayLow = getRaw(sd, 'regularMarketDayLow');
    const beta = getRaw(dks, 'beta');
    
    // Next earnings date
    let nextEarningsDate: string | null = null;
    const ed = ce?.earnings?.earningsDate;
    if (Array.isArray(ed) && ed.length > 0 && ed[0]?.raw) {
      nextEarningsDate = new Date(ed[0].raw * 1000).toISOString().split('T')[0];
    } else if (typeof ed === 'number') {
      nextEarningsDate = new Date(ed * 1000).toISOString().split('T')[0];
    }

    return {
      symbol: symbol.toUpperCase(),
      eps: eps ?? forwardEps ?? null,
      pe: trailingPE ?? forwardPE ?? null,
      high52w: null,
      low52w: null,
      beta: beta ?? null,
      dividendYield: dividendYield != null ? dividendYield * 100 : null,
      dividendRate: dividendRate ?? null,
      marketCap: marketCap ?? null,
      volume: volume ?? null,
      avgVolume: avgVolume ?? null,
      dayHigh: dayHigh ?? null,
      dayLow: dayLow ?? null,
      numAnalysts: numAnalysts ?? null,
      recommendation: recommendationKey,
      nextEarningsDate,
      source: 'yahoo' as const,
    };
  } catch {
    return null;
  }
}

/**
 * Get fundamental metrics.
 * Chain: Finnhub → Yahoo
 */
export async function getFundamentals(symbol: string): Promise<FundamentalMetrics | null> {
  const fh = await finnhubFundamentals(symbol);
  if (fh && (fh.pe != null || fh.eps != null)) return fh;
  return yahooFundamentals(symbol);
}

export interface NewsItem {
  title: string;
  link: string;
  publisher: string;
  pubDate: string;
}

/**
 * Get recent news headlines for a symbol.
 * Chain: Finnhub company-news → Yahoo RSS
 */
export async function getStockNews(symbol: string, count = 3): Promise<NewsItem[]> {
  // Try Finnhub first
  const fhKey = finnhubKey();
  if (fhKey) {
    try {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const to = new Date().toISOString().split('T')[0];
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol.toUpperCase())}&from=${from}&to=${to}&token=${fhKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.slice(0, count).map((n: any) => ({
            title: n.headline || '',
            link: n.url || '',
            publisher: n.source || 'Finnhub',
            pubDate: n.datetime ? new Date(n.datetime * 1000).toISOString() : '',
          }));
        }
      }
    } catch { /* fall through to Yahoo */ }
  }

  // Fallback: Yahoo RSS
  try {
    const ySymbol = yahooSymbol(symbol.toUpperCase());
    const res = await fetch(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ySymbol)}&region=US&lang=en-US`,
      { headers: { 'User-Agent': YAHOO_UA }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const xml = await res.text();
    
    // Parse RSS XML (lightweight, no external deps)
    const items: NewsItem[] = [];
    const itemRegex = /<item>[\s\S]*?<\/item>/g;
    const tagRegex = /<(\w+)>([^<]*)<\/\1>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < count) {
      const itemXml = match[0];
      const fields: Record<string, string> = {};
      let tm;
      while ((tm = tagRegex.exec(itemXml)) !== null) {
        if (tm[1] && tm[2] && !fields[tm[1]]) {
          fields[tm[1]] = tm[2];
        }
      }
      if (fields.title && fields.link) {
        // Extract publisher from link domain
        let publisher = 'Yahoo Finance';
        try {
          const host = new URL(fields.link).hostname;
          publisher = host.replace(/^www\./, '').split('.')[0];
          // Capitalize first letter
          publisher = publisher.charAt(0).toUpperCase() + publisher.slice(1);
        } catch {}
        items.push({
          title: fields.title,
          link: fields.link,
          publisher,
          pubDate: fields.pubDate || '',
        });
      }
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Get historical candles/bars.
 * Chain: Alpaca → Yahoo → Finnhub
 *
 * @param resolution - For Finnhub: '1','5','15','30','60','D','W','M'
 *                     For Alpaca/Yahoo: converted to timeframe
 */
export async function getCandles(
  symbol: string,
  resolution: string = 'D',
  from?: number,
  to?: number,
  limit: number = 100
): Promise<Candle[] | null> {
  const now = Math.floor(Date.now() / 1000);
  const fromTs = from || (now - 30 * 24 * 60 * 60); // default 30 days
  const toTs = to || now;

  // Map resolution to Yahoo range/interval and Alpaca timeframe
  const tfMap: Record<string, { yahooRange: string; yahooInterval: string; alpacaTf: string }> = {
    '1': { yahooRange: '1d', yahooInterval: '1m', alpacaTf: '1Min' },
    '5': { yahooRange: '5d', yahooInterval: '5m', alpacaTf: '5Min' },
    '15': { yahooRange: '7d', yahooInterval: '15m', alpacaTf: '15Min' },
    '30': { yahooRange: '30d', yahooInterval: '30m', alpacaTf: '30Min' },
    '60': { yahooRange: '60d', yahooInterval: '1h', alpacaTf: '1Hour' },
    D: { yahooRange: '3mo', yahooInterval: '1d', alpacaTf: '1Day' },
    W: { yahooRange: '1y', yahooInterval: '1wk', alpacaTf: '1Week' },
    M: { yahooRange: '2y', yahooInterval: '1mo', alpacaTf: '1Month' },
  };

  const mapping = tfMap[resolution] || tfMap.D;

  // 1. Alpaca
  const startISO = new Date(fromTs * 1000).toISOString();
  const endISO = new Date(toTs * 1000).toISOString();
  const ap = await alpacaCandles(symbol, mapping.alpacaTf, startISO, endISO, limit);
  if (ap && ap.length > 0) return ap;

  // 2. Yahoo
  const yh = await yahooCandles(symbol, mapping.yahooRange, mapping.yahooInterval);
  if (yh && yh.length > 0) return yh;

  // 3. Finnhub
  return finnhubCandles(symbol, resolution, fromTs, toTs);
}

/**
 * Check if any market data source is configured.
 */
export function isConfigured(): boolean {
  return !!(finnhubKey() || alpacaKeys());
}

/**
 * Get which sources are currently available.
 */
export function availableSources(): { finnhub: boolean; alpaca: boolean; yahoo: boolean } {
  return {
    finnhub: !!finnhubKey(),
    alpaca: !!alpacaKeys(),
    yahoo: true, // always available (free)
  };
}

// ─── ETF Data (Yahoo fundProfile/fundPerformance + Finnhub /etf/list) ───
//
// ETFs need fund-appropriate fields that the stock fundamentals path
// (P/E, EPS, beta) does NOT provide. We source from Yahoo's quoteSummary
// `fundProfile` (expense ratio, category, fund family), `summaryDetail`
// (AUM, trailing yield) and `fundPerformance` (trailing 1/3/5yr returns),
// plus Finnhub's `/etf/list` for the discovery universe.

const YAHOO_QUOTE_SUMMARY_BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';

/**
 * Fund-level profile fields, live-sourced. All percentage fields are
 * stored as percentages (e.g. 0.09 = 0.09% expense ratio, 12.34 = 12.34%
 * trailing return) — NOT raw fractions.
 */
export interface EtfProfile {
  symbol: string;
  name: string;
  category: string | null;        // fundProfile.categoryName (Morningstar-style)
  fundFamily: string | null;      // fundProfile.family
  expenseRatioPct: number | null; // annual report expense ratio, %
  aum: number | null;             // total assets, USD
  dividendYieldPct: number | null;// trailing annual dividend yield, %
  returnYtdPct: number | null;
  return1yPct: number | null;
  return3yPct: number | null;
  return5yPct: number | null;
  indexTracked: string | null;    // best-effort, derived from name/description
  description: string | null;
  source: 'yahoo';
}

/** Parse a Yahoo value object ({ raw, fmt }) into a percentage number. */
function yahooPct(v: any): number | null {
  const raw = v?.raw;
  if (raw == null || typeof raw !== 'number' || !isFinite(raw)) return null;
  // Yahoo stores ratios as fractions (0.0123 = 1.23%); multiply by 100.
  // Guard against the occasional already-percent value (> 5 for a ratio is
  // almost certainly already a percentage, e.g. a 6.5% yield would be 0.065 raw).
  return Math.abs(raw) < 5 ? raw * 100 : raw;
}

/** Best-effort extraction of the tracked index from an ETF's name/description. */
function extractIndexTracked(name: string, description: string | null): string | null {
  const text = `${name || ''} ${description || ''}`;
  const patterns = [
    /S&P\s*500/i, /S&P\s*MidCap\s*400/i, /S&P\s*SmallCap\s*600/i,
    /Nasdaq-?100/i, /Nasdaq\s*Composite/i, /Dow\s*Jones/i, /Dow\s*30/i,
    /Russell\s*2000/i, /Russell\s*1000/i, /Russell\s*3000/i,
    /MSCI\s*(EAFE|Emerging|World|ACWI|USA)/i, /FTSE/i, /Bloomberg\s*(US\s*)?Agg/i,
    /NYSE\s*(Composite|Arca)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim();
  }
  return null;
}

/**
 * Fetch a single ETF's fund profile from Yahoo quoteSummary.
 * Returns null if the symbol is not an ETF or Yahoo is unreachable.
 */
export async function getEtfProfile(symbol: string): Promise<EtfProfile | null> {
  const auth = await getYahooCrumb();
  if (!auth) return null;

  const ySymbol = yahooSymbol(symbol.toUpperCase());
  const modules = 'fundProfile,summaryDetail,fundPerformance,price';
  try {
    const res = await fetch(
      `${YAHOO_QUOTE_SUMMARY_BASE}/${encodeURIComponent(ySymbol)}?modules=${modules}&crumb=${auth.crumb}`,
      { headers: { 'User-Agent': YAHOO_UA, 'Cookie': auth.cookie }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;

    const fp = result.fundProfile || {};
    const sd = result.summaryDetail || {};
    const fperf = result.fundPerformance || {};
    const priceMod = result.price || {};

    const getRaw = (obj: any, key: string): number | null => {
      const v = obj?.[key];
      if (v && typeof v === 'object' && 'raw' in v && typeof v.raw === 'number') return v.raw;
      return null;
    };

    // Expense ratio: prefer annual report, fall back to net (annual).
    const fees = fp.feesExpensesInvestment || {};
    const expenseRaw = fees.annualReportExpenseRatio ?? fees.annualExpenseRatio ?? null;
    const expenseRatioPct = yahooPct(expenseRaw);

    const aum = getRaw(sd, 'totalAssets');
    // ETF yield lives in `summaryDetail.yield` (trailing 12-month). `trailingAnnualDividendYield`
    // is frequently an empty {} for funds, so prefer `yield` and fall back to it.
    const dividendYieldPct = yahooPct(sd.yield) ?? yahooPct(sd.trailingAnnualDividendYield);

    const name = typeof priceMod?.longName === 'string' ? priceMod.longName
      : (typeof priceMod?.shortName === 'string' ? priceMod.shortName : symbol.toUpperCase());
    const description = typeof fp?.description === 'string' ? fp.description : null;

    // Trailing returns — Yahoo `fundPerformance.trailingReturns` is an OBJECT keyed
    // by period (ytd, oneMonth, threeMonth, oneYear, threeYear, fiveYear, tenYear),
    // each a { raw, fmt }. `performanceOverview` is the alternate shape.
    let returnYtdPct: number | null = null;
    let return1yPct: number | null = null;
    let return3yPct: number | null = null;
    let return5yPct: number | null = null;
    const trailing = fperf?.trailingReturns;
    if (trailing && typeof trailing === 'object' && !Array.isArray(trailing)) {
      returnYtdPct = yahooPct(trailing.ytd);
      return1yPct = yahooPct(trailing.oneYear);
      return3yPct = yahooPct(trailing.threeYear);
      return5yPct = yahooPct(trailing.fiveYear);
    }
    if (return1yPct == null || return3yPct == null || return5yPct == null) {
      const po = fperf?.performanceOverview;
      if (po && typeof po === 'object') {
        returnYtdPct = returnYtdPct ?? yahooPct(po.ytdReturnPct);
        return1yPct = return1yPct ?? yahooPct(po.oneYearTotalReturn);
        return3yPct = return3yPct ?? yahooPct(po.threeYearTotalReturn);
        return5yPct = return5yPct ?? yahooPct(po.fiveYrAvgReturnPct);
      }
    }

    return {
      symbol: symbol.toUpperCase(),
      name,
      category: typeof fp?.categoryName === 'string' ? fp.categoryName : null,
      fundFamily: typeof fp?.family === 'string' ? fp.family : null,
      expenseRatioPct,
      aum,
      dividendYieldPct,
      returnYtdPct,
      return1yPct,
      return3yPct,
      return5yPct,
      indexTracked: extractIndexTracked(name, description),
      description,
      source: 'yahoo',
    };
  } catch {
    return null;
  }
}

/** Curated fallback universe used when Finnhub `/etf/list` is unavailable. */
export const FALLBACK_ETF_UNIVERSE: { symbol: string; description: string }[] = [
  { symbol: 'SPY', description: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'VOO', description: 'Vanguard S&P 500 ETF' },
  { symbol: 'IVV', description: 'iShares Core S&P 500 ETF' },
  { symbol: 'QQQ', description: 'Invesco QQQ Trust (Nasdaq-100)' },
  { symbol: 'VTI', description: 'Vanguard Total Stock Market ETF' },
  { symbol: 'ITOT', description: 'iShares Core S&P Total US Stock Market' },
  { symbol: 'SCHB', description: 'Schwab US Broad Market ETF' },
  { symbol: 'IWM', description: 'iShares Russell 2000 ETF' },
  { symbol: 'IJH', description: 'iShares Core S&P Mid-Cap ETF' },
  { symbol: 'IJR', description: 'iShares Core S&P Small-Cap ETF' },
  { symbol: 'DIA', description: 'SPDR Dow Jones Industrial Average ETF' },
  { symbol: 'VEA', description: 'Vanguard FTSE Developed Markets ETF' },
  { symbol: 'VWO', description: 'Vanguard FTSE Emerging Markets ETF' },
  { symbol: 'IEFA', description: 'iShares Core MSCI EAFE ETF' },
  { symbol: 'EFA', description: 'iShares MSCI EAFE ETF' },
  { symbol: 'SCHF', description: 'Schwab International Equity ETF' },
  { symbol: 'VXUS', description: 'Vanguard Total International Stock ETF' },
  { symbol: 'BND', description: 'Vanguard Total Bond Market ETF' },
  { symbol: 'AGG', description: 'iShares Core US Aggregate Bond ETF' },
  { symbol: 'SCHD', description: 'Schwab US Dividend Equity ETF' },
  { symbol: 'VYM', description: 'Vanguard High Dividend Yield ETF' },
  { symbol: 'DGRO', description: 'iShares Core Dividend Growth ETF' },
  { symbol: 'HDV', description: 'iShares Core High Dividend ETF' },
  { symbol: 'VIG', description: 'Vanguard Dividend Appreciation ETF' },
  { symbol: 'SPHD', description: 'Invesco S&P 500 High Dividend Low Volatility ETF' },
  { symbol: 'XLF', description: 'Financial Select Sector SPDR Fund' },
  { symbol: 'VFH', description: 'Vanguard Financials ETF' },
  { symbol: 'XLK', description: 'Technology Select Sector SPDR Fund' },
  { symbol: 'VGT', description: 'Vanguard Information Technology ETF' },
  { symbol: 'SMH', description: 'VanEck Semiconductor ETF' },
  { symbol: 'SOXX', description: 'iShares Semiconductor ETF' },
  { symbol: 'XLV', description: 'Health Care Select Sector SPDR Fund' },
  { symbol: 'VHT', description: 'Vanguard Health Care ETF' },
  { symbol: 'IBB', description: 'iShares Biotechnology ETF' },
  { symbol: 'XLI', description: 'Industrial Select Sector SPDR Fund' },
  { symbol: 'VIS', description: 'Vanguard Industrials ETF' },
  { symbol: 'XLE', description: 'Energy Select Sector SPDR Fund' },
  { symbol: 'VDE', description: 'Vanguard Energy ETF' },
  { symbol: 'XLU', description: 'Utilities Select Sector SPDR Fund' },
  { symbol: 'VPU', description: 'Vanguard Utilities ETF' },
  { symbol: 'XLRE', description: 'Real Estate Select Sector SPDR Fund' },
  { symbol: 'VNQ', description: 'Vanguard Real Estate ETF' },
  { symbol: 'XLY', description: 'Consumer Discretionary Select Sector SPDR Fund' },
  { symbol: 'XLP', description: 'Consumer Staples Select Sector SPDR Fund' },
  { symbol: 'XLB', description: 'Materials Select Sector SPDR Fund' },
  { symbol: 'VAW', description: 'Vanguard Materials ETF' },
  { symbol: 'XLC', description: 'Communication Services Select Sector SPDR Fund' },
  { symbol: 'XBI', description: 'SPDR S&P Biotech ETF' },
  { symbol: 'ARKK', description: 'ARK Innovation ETF' },
  { symbol: 'IYH', description: 'iShares US Healthcare ETF' },
  { symbol: 'IYG', description: 'iShares US Financial Services ETF' },
  { symbol: 'IYW', description: 'iShares US Technology ETF' },
  { symbol: 'IYJ', description: 'iShares US Industrials ETF' },
];

let etfUniverseCache: { data: { symbol: string; description: string }[]; timestamp: number } | null = null;

/**
 * Load the US ETF discovery universe. Primary: Finnhub `/etf/list`
 * (~2000+ US ETFs). Falls back to the curated list when Finnhub is
 * unavailable. Cached for 24h (the list changes rarely).
 */
export async function listEtfUniverse(): Promise<{ symbol: string; description: string }[]> {
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  if (etfUniverseCache && Date.now() - etfUniverseCache.timestamp < CACHE_TTL) {
    return etfUniverseCache.data;
  }

  const key = finnhubKey();
  const result: { symbol: string; description: string }[] = [];
  if (key) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/etf/list?exchange=US&token=${key}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json();
        // Finnhub response shape varies across versions; be defensive.
        let arr: any[] = Array.isArray(data) ? data : [];
        if (arr.length === 0 && Array.isArray(data?.data)) arr = data.data;
        if (arr.length === 0 && data && typeof data === 'object') {
          for (const v of Object.values(data)) {
            if (Array.isArray(v)) { arr = v as any[]; break; }
          }
        }
        for (const item of arr) {
          const sym = item?.symbol || item?.displaySymbol;
          if (!sym) continue;
          result.push({
            symbol: String(sym).toUpperCase(),
            description: item?.description || item?.name || '',
          });
        }
      }
    } catch { /* fall through to curated fallback */ }
  }

  const universe = result.length > 0 ? result : FALLBACK_ETF_UNIVERSE;
  etfUniverseCache = { data: universe, timestamp: Date.now() };
  return universe;
}
