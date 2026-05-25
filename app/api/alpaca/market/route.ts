// ─── Market Data Endpoint ────────────────────────────────────
// Handles quote batches, bar data from Alpaca Data API v2.
//
// GET /api/alpaca/market?symbols=AAPL,TSLA       → batch quotes
// GET /api/alpaca/market?symbol=AAPL&bars=1D     → bars (timeframe)
// GET /api/alpaca/market?symbol=AAPL&bars=1D&start=...&end=...&limit=100  → bars + range

import { type NextRequest, NextResponse } from 'next/server';

const DATA_PAPER = 'https://data.alpaca.markets';
const DATA_LIVE = 'https://data.alpaca.markets';

interface AlpacaQuote {
  ap: number;
  as: number;
  bp: number;
  bs: number;
  t: string;
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function getDataHeaders(): Record<string, string> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!keyId || !secretKey) {
    throw new Error('Alpaca API keys not configured');
  }

  return {
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secretKey,
    'Content-Type': 'application/json',
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const symbols = searchParams.get('symbols');
    const symbol = searchParams.get('symbol');
    const bars = searchParams.get('bars');

    const headers = getDataHeaders();
    const dataUrl = process.env.ALPACA_ENVIRONMENT === 'live' ? DATA_LIVE : DATA_PAPER;

    // ─── Bars request ───────────────────────────────────────
    if (symbol && bars) {
      const tf = bars as string;
      const start = searchParams.get('start');
      const end = searchParams.get('end');
      const limit = searchParams.get('limit');

      const qs = new URLSearchParams({ timeframe: tf });
      if (start) qs.set('start', start);
      if (end) qs.set('end', end);
      if (limit) qs.set('limit', limit);

      const url = `${dataUrl}/v2/stocks/${encodeURIComponent(symbol)}/bars?${qs}`;
      const res = await fetch(url, { headers });
      const raw = await res.json();

      if (!res.ok) {
        return NextResponse.json(
          { error: `Alpaca data error ${res.status}`, message: raw },
          { status: res.status }
        );
      }

      const mapped = {
        symbol,
        bars: ((raw as { bars?: AlpacaBar[] }).bars || []).map((b: AlpacaBar) => ({
          timestamp: b.t,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        })),
      };

      return NextResponse.json(mapped);
    }

    // ─── Batch quotes (via snapshots for richer data) ────────
    if (symbols) {
      const symList = symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (symList.length === 0) {
        return NextResponse.json({ quotes: {} });
      }

      const mapped: Record<string, any> = {};

      // Use snapshots endpoint — includes daily bar + latest trade + previous close
      const snapUrl = `${dataUrl}/v2/stocks/snapshots?symbols=${symList.join(',')}`;
      const snapRes = await fetch(snapUrl, { headers });

      if (!snapRes.ok) {
        // Fall back to quotes endpoint if snapshots fails
        const url = `${dataUrl}/v2/stocks/quotes/latest?symbols=${symList.join(',')}`;
        const res = await fetch(url, { headers });
        const raw = await res.json();
        if (res.ok) {
          const quotes = (raw as { quotes?: Record<string, AlpacaQuote> }).quotes || {};
          for (const [sym, q] of Object.entries(quotes)) {
            if (!q) continue;
            mapped[sym] = { symbol: sym, bid: q.bp || 0, ask: q.ap || 0, last: q.ap || 0, change: 0, changePercent: 0, volume: q.as || 0, high: 0, low: 0, open: 0, previousClose: 0, high52w: 0, low52w: 0, timestamp: Date.now() };
          }
        } else {
          return NextResponse.json(
            { error: `Alpaca quote error ${res.status}`, message: raw },
            { status: res.status }
          );
        }
      } else {
        const snapData = await snapRes.json();
        for (const sym of symList) {
          const snap = snapData[sym];
          if (!snap) continue;
          const trade = snap.latestTrade;
          const dailyBar = snap.dailyBar;
          const prevBar = snap.prevDailyBar;
          const price = trade?.p ?? dailyBar?.c ?? null;
          const prevClose = prevBar?.c ?? null;
          const change = price && prevClose ? price - prevClose : 0;
          const changePercent = change && prevClose ? (change / prevClose) * 100 : 0;

          mapped[sym] = {
            symbol: sym,
            bid: snap.latestQuote?.bp || 0,
            ask: snap.latestQuote?.ap || 0,
            last: price || 0,
            change: +change.toFixed(2),
            changePercent: +changePercent.toFixed(2),
            volume: dailyBar?.v || 0,
            high: dailyBar?.h || 0,
            low: dailyBar?.l || 0,
            open: dailyBar?.o || 0,
            previousClose: prevClose || 0,
            high52w: 0,
            low52w: 0,
            timestamp: trade?.t ? new Date(trade.t).getTime() : Date.now(),
          };
        }
      }

      // Enrich with 52-week range from Finnhub (Alpaca doesn't provide it)
      try {
        const fhKey = process.env.FINNHUB_IO_API_KEY;
        if (fhKey) {
          const fhPromises = symList.map(async (sym) => {
            try {
              const fhRes = await fetch(
                `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${fhKey}`,
                { signal: AbortSignal.timeout(3000) }
              );
              if (!fhRes.ok) return null;
              const fhJson = await fhRes.json();
              return [sym, fhJson] as const;
            } catch {
              return null;
            }
          });
          const results = await Promise.all(fhPromises);
          for (const r of results) {
            if (!r) continue;
            const [sym, fhJson] = r;
            if (mapped[sym]) {
              const h = fhJson['52WeekHigh'];
              const l = fhJson['52WeekLow'];
              if (h != null && h > 0) mapped[sym].high52w = h;
              if (l != null && l > 0) mapped[sym].low52w = l;
            }
          }
        }
      } catch {
        // Non-critical — 52-week range stays at 0
      }

      return NextResponse.json({ quotes: mapped });
    }

    return NextResponse.json({ error: 'Missing symbol or symbols param' }, { status: 400 });
  } catch (err) {
    console.error('[Market API] Error:', err);

    if (err instanceof Error && err.message.includes('not configured')) {
      return NextResponse.json(
        { error: 'Alpaca not configured' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Internal market data error', message: String(err) },
      { status: 500 }
    );
  }
}
