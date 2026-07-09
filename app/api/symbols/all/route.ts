// ─── GET /api/symbols/all — Full US stock symbol list (cached, 24h TTL) ──────
// Client fetches once per session for client-side symbol validation.
// Response: { symbols: string[] }

import { NextResponse } from 'next/server';
import { getCachedSymbols } from '@/lib/symbol-validator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const symbols = await getCachedSymbols();
    return NextResponse.json({
      symbols,
      count: symbols.length,
      cached: symbols.length > 0,
    });
  } catch (err: any) {
    console.error('/api/symbols/all error:', err);
    return NextResponse.json(
      { error: 'Failed to load symbol list', symbols: [], count: 0, cached: false },
      { status: 500 },
    );
  }
}
