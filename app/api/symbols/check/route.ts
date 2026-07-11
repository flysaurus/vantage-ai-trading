// ─── Symbol Check — Single-Symbol Validation ────────────────────────
// Validates individual ticker symbols against Finnhub's /stock/profile2.
// Used by: resolveSymbol tool (chat route), client-side lazy validation,
// and the post-stream marker validator.
//
// GET /api/symbols/check?symbol=SKHYV
//   → { valid: true, symbol: "SKHYV", name: "SK hynix Inc.", type: "ADR", exchange: "OTC" }
//   → { valid: false }
//
// Primarily covers OTC ADR tickers that may not be in the bulk exchange=US
// symbol cache, ensuring the client-side validSymbols universe matches the
// validator's resolveCompanyTicker universe.

import { type NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getApiKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

interface FinnhubProfile {
  name: string;
  ticker: string;
  exchange: string;
  country?: string;
  currency?: string;
  finnhubIndustry?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.toUpperCase()?.trim();

  if (!symbol || symbol.length > 10) {
    return NextResponse.json({ valid: false, error: 'Invalid symbol' }, { status: 400 });
  }

  const key = getApiKey();
  if (!key) {
    return NextResponse.json({ valid: false, error: 'API key not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`,
    );

    if (!res.ok) {
      // Finnhub returns 200 even for invalid symbols but with empty body
      // 404/429 would indicate API issues
      return NextResponse.json({ valid: false, error: `Finnhub API error: ${res.status}` });
    }

    const profile: FinnhubProfile = await res.json();

    // Empty name = symbol not found in Finnhub
    if (!profile.name || !profile.ticker) {
      return NextResponse.json({ valid: false });
    }

    return NextResponse.json({
      valid: true,
      symbol: profile.ticker,
      name: profile.name,
      exchange: profile.exchange || '',
      country: profile.country || '',
      currency: profile.currency || '',
    });
  } catch (err: any) {
    console.error('[symbols/check] Error:', err.message || err);
    return NextResponse.json({ valid: false, error: 'Validation failed' }, { status: 500 });
  }
}
