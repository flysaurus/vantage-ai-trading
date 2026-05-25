// ─── Unified Symbol Search (Finnhub) ──────────────────────────
// Uses Finnhub /search for broad US stock discovery + Alpaca
// snapshots for live price enrichment.
//
// GET /api/symbols/search?q=AAPL
//   → returns { results: [{ symbol, name, exchange, price?, changePercent? }] }

import { type NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const ALPACA_DATA = 'https://data.alpaca.markets';

// Non-US exchange suffixes — these return with Finnhub /search but are not US-listed
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

function getFinnhubToken(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

function getAlpacaHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID || '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
  };
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  price?: number;
  changePercent?: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = getFinnhubToken();
  if (!token) {
    return NextResponse.json({ results: [] });
  }

  try {
    const { searchParams } = req.nextUrl;
    const q = (searchParams.get('q') || '').trim();

    if (q.length < 1) {
      return NextResponse.json({ results: [] });
    }

    // ─── 1. Finnhub search ──────────────────────────────────
    const fhRes = await fetch(
      `${FINNHUB_BASE}/search?q=${encodeURIComponent(q)}&token=${token}`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (!fhRes.ok) {
      return NextResponse.json({ results: [] });
    }

    const fhData = await fhRes.json();
    const rawResults = (fhData.result || []) as Array<{
      symbol: string;
      description: string;
      displaySymbol: string;
      type: string;
    }>;

    // ─── 2. Filter & deduplicate ────────────────────────────
    const seen = new Set<string>();
    const filtered: SymbolSearchResult[] = [];

    for (const r of rawResults) {
      const sym = r.symbol || r.displaySymbol || '';
      if (!sym || seen.has(sym)) continue;
      // Only Common Stock + ETFs, US-listed
      const t = r.type || '';
      if (t !== 'Common Stock' && t !== 'ETF') continue;
      if (!isUSStock(sym)) continue;
      seen.add(sym);
      filtered.push({
        symbol: sym,
        name: r.description || '',
        exchange: '',
        type: t,
      });
      if (filtered.length >= 12) break;
    }

    if (filtered.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // ─── 3. Enrich with Alpaca snapshots (prices) ───────────
    const alpacaKey = process.env.ALPACA_API_KEY_ID;
    if (alpacaKey) {
      try {
        const syms = filtered.map(r => r.symbol).join(',');
        const snapRes = await fetch(
          `${ALPACA_DATA}/v2/stocks/snapshots?symbols=${encodeURIComponent(syms)}`,
          { headers: getAlpacaHeaders(), signal: AbortSignal.timeout(5000) }
        );
        if (snapRes.ok) {
          const snapData = await snapRes.json();
          for (const r of filtered) {
            const snap = snapData[r.symbol];
            if (snap) {
              r.price = snap.latestTrade?.p;
              r.exchange = snap.latestTrade?.x || '';
              if (snap.dailyBar?.c && snap.prevDailyBar?.c) {
                r.changePercent = ((snap.dailyBar.c - snap.prevDailyBar.c) / snap.prevDailyBar.c) * 100;
              }
            }
          }
        }
      } catch { /* prices optional */ }
    }

    return NextResponse.json({ results: filtered });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
