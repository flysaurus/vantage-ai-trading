// ─── GET /api/finnhub/earnings-calendar ──────────────────────
// Fetches upcoming earnings (next 48 hours) for given portfolio symbols.
// Query: ?symbols=AAPL,MSFT,TSLA

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbols = searchParams.get('symbols')?.split(',').map(s => s.trim().toUpperCase()) || [];

  if (!symbols.length) {
    return NextResponse.json([]);
  }

  const today = new Date();
  const in48h = new Date(today.getTime() + 48 * 60 * 60 * 1000);

  const from = today.toISOString().split('T')[0];
  const to = in48h.toISOString().split('T')[0];

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      console.error('[earnings-calendar] Finnhub returned', res.status);
      return NextResponse.json([]);
    }

    const data = await res.json();
    const symbolSet = new Set(symbols);

    const relevant = (data.earningsCalendar || []).filter(
      (e: any) => symbolSet.has(e.symbol?.toUpperCase())
    );

    return NextResponse.json(relevant);
  } catch (err: any) {
    console.error('[earnings-calendar] Error:', err.message);
    return NextResponse.json([]);
  }
}
