// ─── GET /api/symbols/names — Look up display names for symbols ──────
// Accepts ?symbols=SCHD,QQQ,VTI and returns { names: { SCHD: "Schwab...", ... } }

import { NextRequest, NextResponse } from 'next/server';
import { lookupSymbolNames } from '@/lib/symbol-validator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const symbolsParam = req.nextUrl.searchParams.get('symbols');
  if (!symbolsParam) {
    return NextResponse.json({ names: {} });
  }

  const symbols = symbolsParam
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length >= 1 && s.length <= 10);

  if (symbols.length === 0) {
    return NextResponse.json({ names: {} });
  }

  try {
    const namesMap = await lookupSymbolNames(symbols);
    const names: Record<string, string> = {};
    for (const [sym, name] of namesMap) {
      names[sym] = name;
    }
    return NextResponse.json({ names });
  } catch (err: any) {
    console.error('/api/symbols/names error:', err);
    return NextResponse.json({ names: {} }, { status: 500 });
  }
}
