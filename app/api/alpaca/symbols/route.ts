// ─── Symbol Search API ───────────────────────────────────────
// Searches Alpaca assets and enriches with live prices
// GET /api/alpaca/symbols?q=AAPL

import { type NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.ALPACA_ENVIRONMENT === 'live'
  ? 'https://api.alpaca.markets'
  : 'https://paper-api.alpaca.markets';

function getHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID || '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const q = searchParams.get('q') || '';

    if (q.length < 1) {
      return NextResponse.json({ results: [] });
    }

    // Search assets — no exchange filter for maximum coverage
    const res = await fetch(
      `${API_BASE}/v2/assets?status=active&asset_class=us_equity&search=${encodeURIComponent(q)}&limit=15`,
      { headers: getHeaders() }
    );

    if (!res.ok) {
      return NextResponse.json({ results: [] });
    }

    const assets = await res.json();
    const results = assets.slice(0, 12).map((a: any) => ({
      symbol: a.symbol,
      name: a.name || '',
      exchange: a.exchange || '',
    }));

    // Try to get prices via snapshots (Alpaca Data API v2)
    try {
      const symStr = results.map((r: { symbol: string }) => r.symbol).join(',');
      if (symStr) {
        const snapRes = await fetch(
          `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symStr)}`,
          {
            headers: {
              'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID || '',
              'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
            },
          }
        );
        if (snapRes.ok) {
          const snapData = await snapRes.json();
          for (const r of results as any[]) {
            const snap = snapData[r.symbol];
            if (snap) {
              r.price = snap.latestTrade?.p;
              if (snap.dailyBar?.c && snap.prevDailyBar?.c) {
                r.changePercent = ((snap.dailyBar.c - snap.prevDailyBar.c) / snap.prevDailyBar.c) * 100;
              }
            }
          }
        }
      }
    } catch {
      // Continue without prices
    }

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
