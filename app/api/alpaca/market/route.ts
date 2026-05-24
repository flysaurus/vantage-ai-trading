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

    // ─── Batch quotes ──────────────────────────────────────
    if (symbols) {
      const symList = symbols.split(',').map((s) => s.trim().toUpperCase());
      if (symList.length === 0 || symList[0] === '') {
        return NextResponse.json({ quotes: {} });
      }

      const url = `${dataUrl}/v2/stocks/quotes/latest?symbols=${symList.join(',')}`;
      const res = await fetch(url, { headers });
      const raw = await res.json();

      if (!res.ok) {
        return NextResponse.json(
          { error: `Alpaca quote error ${res.status}`, message: raw },
          { status: res.status }
        );
      }

      // Map Alpaca response to our Quote shape
      const quotes = (raw as { quotes?: Record<string, AlpacaQuote> }).quotes || {};
      const mapped: Record<string, {
        symbol: string;
        bid: number;
        ask: number;
        last: number;
        change: number;
        changePercent: number;
        volume: number;
        high: number;
        low: number;
        open: number;
        previousClose: number;
        high52w: number;
        low52w: number;
        timestamp: number;
      }> = {};

      for (const [sym, q] of Object.entries(quotes)) {
        if (!q) continue;
        mapped[sym] = {
          symbol: sym,
          bid: q.bp || 0,
          ask: q.ap || 0,
          last: q.ap || 0,
          change: 0,
          changePercent: 0,
          volume: q.as || 0,
          high: 0,
          low: 0,
          open: 0,
          previousClose: 0,
          high52w: 0,
          low52w: 0,
          timestamp: Date.now(),
        };
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
