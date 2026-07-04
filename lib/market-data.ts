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
  marketCap: number | null;
  source: 'finnhub';
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
      marketCap: m.marketCapitalization != null ? m.marketCapitalization * 1e6 : null,
      source: 'finnhub',
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
export async function getBatchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  if (symbols.length === 0) return new Map();

  const remaining = new Set(symbols.map(s => s.toUpperCase()));
  const results = new Map<string, Quote>();

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
          results.set(r.value.symbol, r.value);
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
        results.set(sym, quote);
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
        results.set(sym, quote);
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
  if (results.size > 0) {
    const symArr = [...results.keys()];
    let enriched = 0;
    let yahooFallback = 0;
    for (let i = 0; i < symArr.length; i++) {
      const sym = symArr[i];
      const q = results.get(sym)!;
      // Skip if quote already has valid 52-week range
      if (q.high52w != null && q.high52w > 0) continue;

      try {
        // Try Finnhub first (only if key available)
        if (fhKey) {
          const metric = await finnhubFundamentals(sym, 4000);
          if (metric?.high52w != null && metric.high52w > 0) {
            results.set(sym, { ...q, high52w: metric.high52w, low52w: metric.low52w ?? q.low52w });
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
              results.set(sym, {
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

/**
 * Get fundamental metrics.
 * Finnhub only — Yahoo free API doesn't expose these well.
 */
export async function getFundamentals(symbol: string): Promise<FundamentalMetrics | null> {
  return finnhubFundamentals(symbol);
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
