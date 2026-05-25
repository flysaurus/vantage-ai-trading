// ─── POST /api/screener/search ────────────────────────────────
// Stock screener powered by Finnhub. Applies client-side filters
// against Finnhub company profiles + metrics.
// Free tier: 60 req/min — batch fetches, limited result sets.

import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// ─── In-memory symbol cache (survives across warm invocations) ─
let symbolCache: { symbols: string[]; ts: number } | null = null;
const SYMBOL_CACHE_MS = 60 * 60 * 1000; // 1 hour

function getToken(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

// ─── US stock filter ──────────────────────────────────────────
const INT_PATTERNS = [
  /\.T$/, /\.L$/, /\.MC$/, /\.SW$/, /\.PA$/, /\.DE$/, /\.HK$/, /\.TO$/,
  /\.AX$/, /\.ST$/, /\.CO$/, /\.HE$/, /\.MI$/, /\.VI$/, /\.OL$/,
  /\.BR$/, /\.LS$/, /\.AS$/, /\.BO$/, /\.NS$/, /\.SZ$/, /\.SS$/,
  /\.KS$/, /\.KQ$/, /\.TW$/, /\.TWO$/, /\.SI$/, /\.JK$/, /\.KL$/,
  /\.SA$/, /\.MX$/, /\.BA$/, /\.SN$/, /\.IL$/, /\.WA$/, /\.IR$/,
  /\.NZ$/, /\.V$/, /\.CN$/,
];
function isUSStock(s: string): boolean {
  if (!s || !/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return false;
  for (const p of INT_PATTERNS) { if (p.test(s)) return false; }
  return true;
}

export interface ScreenerFilters {
  marketCap?: 'micro' | 'small' | 'mid' | 'large' | 'mega';
  peMin?: number;
  peMax?: number;
  dividendYieldMin?: number;
  dividendYieldMax?: number;
  sector?: string;
  priceMin?: number;
  priceMax?: number;
  week52ChangeMin?: number;
  week52ChangeMax?: number;
  exchange?: string;
}

export interface ScreenerResult {
  symbol: string;
  name: string;
  price: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  sector: string;
  week52High: number | null;
  week52Low: number | null;
  week52Change: number | null;
  exchange: string;
}

// ─── Market cap ranges ────────────────────────────────────────
const MARKET_CAP_RANGES: Record<string, [number, number]> = {
  micro: [0, 300e6],
  small: [300e6, 2e9],
  mid: [2e9, 10e9],
  large: [10e9, 200e9],
  mega: [200e9, Infinity],
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = getToken();
  if (!token) {
    return NextResponse.json({ error: 'Finnhub not configured' }, { status: 503 });
  }

  try {
    const filters: ScreenerFilters = await req.json().catch(() => ({}));

    // ─── 1. Get symbol list (cached) ─────────────────────────
    const exchangeParam = filters.exchange || 'US';
    let symbols: string[] = [];
    if (symbolCache && Date.now() - symbolCache.ts < SYMBOL_CACHE_MS) {
      symbols = symbolCache.symbols;
    } else {
      const symRes = await fetch(
        `${FINNHUB_BASE}/stock/symbol?exchange=${encodeURIComponent(exchangeParam)}&token=${token}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (symRes.ok) {
        const symData = await symRes.json();
        symbols = (Array.isArray(symData) ? symData.map((s: any) => s.symbol || s.displaySymbol) : []).filter(Boolean);
        // Filter to US-listed stocks only
        symbols = symbols.filter(isUSStock);
        symbolCache = { symbols, ts: Date.now() };
      }
    }

    if (!symbols.length) {
      return NextResponse.json({ results: [], total: 0, message: 'No symbols available' });
    }

    // ─── 2. Smart pre-filter ─────────────────────────────────
    // If sector filter applied, we need to fetch profiles to know industries.
    // Take a manageable batch. For full scans, limit to 200 symbols.
    let candidates = symbols.slice(0, 200);

    // ─── 3. Fetch profiles in parallel batches of 10 ─────────
    const batchSize = 10;
    const maxBatches = Math.min(Math.ceil(candidates.length / batchSize), 10); // limit to 100 profiles
    const limited = candidates.slice(0, maxBatches * batchSize);

    const profiles: any[] = [];
    for (let i = 0; i < limited.length; i += batchSize) {
      const batch = limited.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(sym =>
          fetch(
            `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`,
            { signal: AbortSignal.timeout(4000) }
          ).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.ticker) profiles.push(r.value);
      }
      // Small delay between batches to respect rate limits
      if (i + batchSize < limited.length) await new Promise(r => setTimeout(r, 200));
    }

    // ─── 4. Apply filters ────────────────────────────────────
    const sectorFilter = filters.sector?.toLowerCase();
    const results: ScreenerResult[] = [];

    for (const p of profiles) {
      const symbol = p.ticker || '';
      const name = p.name || '';
      const marketCap = p.marketCapitalization != null ? p.marketCapitalization * 1e6 : null;
      const industry = p.finnhubIndustry || '';
      const exchange = p.exchange || '';
      const price = null; // price not in profile — would need quote call
      const sector = industry; // raw industry for now

      // Sector filter
      if (sectorFilter && !industry.toLowerCase().includes(sectorFilter)) continue;

      // Market cap filter
      if (filters.marketCap) {
        const [lo, hi] = MARKET_CAP_RANGES[filters.marketCap] || [0, Infinity];
        if (marketCap == null) continue;
        if (marketCap < lo || marketCap > hi) continue;
      }

      results.push({
        symbol,
        name: name || symbol,
        price: null,
        peRatio: null,
        dividendYield: null,
        marketCap,
        sector: industry || 'Unknown',
        week52High: null,
        week52Low: null,
        week52Change: null,
        exchange,
      });
    }

    // ─── 5. Enrich with metrics for top results ──────────────
    const topResults = results.slice(0, 30);
    for (let i = 0; i < topResults.length; i += 3) {
      const batch = topResults.slice(i, i + 3);
      const metricResults = await Promise.allSettled(
        batch.map(r =>
          fetch(
            `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(r.symbol)}&metric=all&token=${token}`,
            { signal: AbortSignal.timeout(4000) }
          ).then(res => res.ok ? res.json() : null).catch(() => null)
        )
      );
      for (let j = 0; j < batch.length; j++) {
        const mr = metricResults[j];
        if (mr.status !== 'fulfilled' || !mr.value?.metric) continue;
        const m = mr.value.metric;
        batch[j].peRatio = m.peBasicExclExtraTTM ?? null;
        batch[j].dividendYield = m.dividendYieldIndicatedAnnual ?? null;
        batch[j].week52High = m['52WeekHigh'] ?? null;
        batch[j].week52Low = m['52WeekLow'] ?? null;
        if (batch[j].week52High && batch[j].week52Low) {
          const mid = (batch[j].week52High! + batch[j].week52Low!) / 2;
          batch[j].week52Change = ((batch[j].week52High! - mid) / mid) * 100;
        }
        // Price from metrics
        batch[j].price = m.currentPrice ?? m['priceRelativeToS&P500Close'] ?? null;
      }
      if (i + 3 < topResults.length) await new Promise(r => setTimeout(r, 150));
    }

    // ─── 6. Apply numeric filters ────────────────────────────
    let final = results;
    if (filters.peMin != null) final = final.filter(s => s.peRatio != null && s.peRatio >= filters.peMin!);
    if (filters.peMax != null) final = final.filter(s => s.peRatio != null && s.peRatio <= filters.peMax!);
    if (filters.dividendYieldMin != null) final = final.filter(s => s.dividendYield != null && s.dividendYield >= filters.dividendYieldMin!);
    if (filters.dividendYieldMax != null) final = final.filter(s => s.dividendYield != null && s.dividendYield <= filters.dividendYieldMax!);

    return NextResponse.json({
      results: final.slice(0, 50),
      total: final.length,
      scanned: profiles.length,
    });
  } catch (err: any) {
    console.error('[screener] error:', err.message);
    return NextResponse.json({ error: 'Screener failed', results: [], total: 0 }, { status: 200 });
  }
}
