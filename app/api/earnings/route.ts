// ─── GET /api/earnings ────────────────────────────────────────
// Fetches earnings calendar from Finnhub.
// GET /api/earnings?symbols=AAPL,MSFT — company filter (optional)

import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

export interface EarningsEvent {
  symbol: string;
  date: string;        // YYYY-MM-DD
  hour: 'bmo' | 'amc' | 'unknown';  // before market open / after market close
  year: number;
  quarter: number;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = getToken();
  if (!token) {
    return NextResponse.json({ error: 'Earnings API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const symbolsParam = (searchParams.get('symbols') || '').toUpperCase();
    const days = Math.min(parseInt(searchParams.get('days') || '90', 10), 365);
    const symbols = symbolsParam
      ? symbolsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20)
      : [];

    const fromDate = new Date().toISOString().split('T')[0];
    const toDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const res = await fetch(
      `${FINNHUB_BASE}/calendar/earnings?from=${fromDate}&to=${toDate}&token=${token}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Finnhub API error', earnings: [] }, { status: 200 });
    }

    const data = await res.json();
    const all: EarningsEvent[] = (data.earningsCalendar || []).map((e: any) => ({
      symbol: e.symbol || '',
      date: e.date || '',
      hour: e.hour || 'unknown',
      year: e.year || new Date().getFullYear(),
      quarter: e.quarter || 1,
      epsEstimate: e.epsEstimate ?? null,
      epsActual: e.epsActual ?? null,
      revenueEstimate: e.revenueEstimate ?? null,
      revenueActual: e.revenueActual ?? null,
    }));

    // Filter by symbol if requested
    const filtered = symbols.length > 0
      ? all.filter(e => symbols.includes(e.symbol))
      : all;

    // Sort by date
    filtered.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ earnings: filtered });
  } catch (err: any) {
    console.error('[earnings] fetch error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch earnings', earnings: [] }, { status: 200 });
  }
}
