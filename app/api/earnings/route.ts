// ─── GET /api/earnings ────────────────────────────────────────
// Fetches earnings calendar from Finnhub.
// GET /api/earnings?days=90 — all upcoming
// GET /api/earnings?symbols=AAPL,MSFT — company filter
// GET /api/earnings?q=AAPL — autocomplete search (symbol prefix)
// GET /api/earnings?status=beat — filter by result status

import { NextRequest, NextResponse } from 'next/server';
import type { EarningsEvent } from '@/types';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

// Known US exchanges — used to filter stocks
const US_PATTERNS = [
  /^[A-Z]{1,5}$/,          // Standard US symbols: AAPL, MSFT
  /^[A-Z]{1,5}\.[A-Z]$/,  // Class shares: BRK.A, BRK.B
];

// Non-US indicators — symbols containing these patterns are international
const INTERNATIONAL_PATTERNS = [
  /\.T$/,     // Tokyo
  /\.L$/,     // London
  /\.MC$/,    // Madrid
  /\.SW$/,    // Swiss
  /\.PA$/,    // Paris
  /\.DE$/,    // Germany
  /\.HK$/,    // Hong Kong
  /\.TO$/,    // Toronto
  /\.AX$/,    // Australia
  /\.ST$/,    // Stockholm
  /\.CO$/,    // Copenhagen
  /\.HE$/,    // Helsinki
  /\.MI$/,    // Milan
  /\.VI$/,    // Vienna
  /\.OL$/,    // Oslo
  /\.BR$/,    // Brussels
  /\.LS$/,    // Lisbon
  /\.AS$/,    // Amsterdam
  /\.BO$/,    // Bombay
  /\.NS$/,    // NSE India
  /\.SZ$/,    // Shenzhen
  /\.SS$/,    // Shanghai
  /\.KS$/,    // Korea
  /\.KQ$/,    // KOSDAQ
  /\.TW$/,    // Taiwan
  /\.TWO$/,   // Taiwan OTC
  /\.SI$/,    // Singapore
  /\.JK$/,    // Jakarta
  /\.KL$/,    // Kuala Lumpur
  /\.SA$/,    // Sao Paulo
  /\.MX$/,    // Mexico
  /\.BA$/,    // Buenos Aires
  /\.SN$/,    // Santiago
  /\.IL$/,    // Tel Aviv
  /\.WA$/,    // Warsaw
  /\.IR$/,    // Ireland
  /\.NZ$/,    // New Zealand
  /\.V$/,     // TSX Venture
  /\.CN$/,    // Canada
  /-/,         // OTC with hyphens (e.g. VRMMQ, BKFG)
  /Q$/,        // Bankruptcy Q suffix (e.g. VRMMQ)
];

function isUSStock(symbol: string): boolean {
  if (!symbol) return false;
  // Must match a US pattern
  for (const p of US_PATTERNS) {
    if (p.test(symbol)) {
      // Check it's not international
      for (const ip of INTERNATIONAL_PATTERNS) {
        if (ip.test(symbol)) return false;
      }
      return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = getToken();
  if (!token) {
    return NextResponse.json({ error: 'Earnings API not configured' }, { status: 503 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const searchQuery = (searchParams.get('q') || '').toUpperCase().trim();
    const symbolsParam = (searchParams.get('symbols') || '').toUpperCase();
    const days = Math.min(parseInt(searchParams.get('days') || '90', 10), 365);
    const statusFilter = searchParams.get('status') || '';
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
    let all: EarningsEvent[] = (data.earningsCalendar || []).map((e: any) => {
      const epsEstimate = e.epsEstimate ?? null;
      const epsActual = e.epsActual ?? null;
      const beat = epsEstimate != null && epsActual != null
        ? (Math.abs(epsActual - epsEstimate) < 0.01 ? null : epsActual > epsEstimate)
        : null;

      return {
        symbol: e.symbol || '',
        date: e.date || '',
        hour: e.hour || 'unknown',
        year: e.year || new Date().getFullYear(),
        quarter: e.quarter || 1,
        epsEstimate,
        epsActual,
        revenueEstimate: e.revenueEstimate ?? null,
        revenueActual: e.revenueActual ?? null,
        reportDate: null, // populated later via Finnhub if needed
        beat,
        source: 'Finnhub',
      };
    });

    // Filter: US stocks only
    all = all.filter(e => isUSStock(e.symbol));

    // Filter by symbol if requested
    if (symbols.length > 0) {
      all = all.filter(e => symbols.includes(e.symbol));
    }

    // Filter by search query (autocomplete — match symbol prefix)
    if (searchQuery) {
      all = all.filter(e => e.symbol.startsWith(searchQuery));
    }

    // Filter by status
    if (statusFilter === 'beat') {
      all = all.filter(e => e.beat === true);
    } else if (statusFilter === 'miss') {
      all = all.filter(e => e.beat === false);
    } else if (statusFilter === 'upcoming') {
      all = all.filter(e => e.epsActual == null);
    }

    // Sort by date
    all.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

    return NextResponse.json({ earnings: all });
  } catch (err: any) {
    console.error('[earnings] fetch error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch earnings', earnings: [] }, { status: 200 });
  }
}
