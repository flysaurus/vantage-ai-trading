// ─── Sector Resolution API ────────────────────────────────────
// Resolves industry→sector for symbols using Alpaca asset data.
// GET /api/alpaca/sectors?symbols=AAPL,AXP,TSLA

import { type NextRequest, NextResponse } from 'next/server';
import { industryToSector } from '@/lib/sectors';

const API_BASE = process.env.ALPACA_ENVIRONMENT === 'live'
  ? 'https://api.alpaca.markets'
  : 'https://paper-api.alpaca.markets';

function getHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY_ID || '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY || '',
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const symbolsParam = searchParams.get('symbols') || '';
  const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({ sectors: {} });
  }

  // Batch up to 50 symbols
  const batch = symbols.slice(0, 50);
  const sectors: Record<string, string | null> = {};

  try {
    // Fetch asset data for each symbol (Alpaca doesn't have a batch asset endpoint)
    const promises = batch.map(async (symbol) => {
      try {
        const res = await fetch(`${API_BASE}/v2/assets/${encodeURIComponent(symbol)}`, {
          headers: getHeaders(),
        });
        if (!res.ok) return { symbol, sector: null };
        const asset = await res.json();
        const industry = asset.industry || '';
        const sector = industryToSector(industry);
        return { symbol, sector: sector || null };
      } catch {
        return { symbol, sector: null };
      }
    });

    const results = await Promise.all(promises);
    for (const { symbol, sector } of results) {
      sectors[symbol] = sector;
    }

    return NextResponse.json({ sectors });
  } catch (err) {
    console.error('[Sectors API] Error:', err);
    return NextResponse.json({ sectors: {} }, { status: 500 });
  }
}
