import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  const token = process.env.FINNHUB_IO_API_KEY;
  if (!token) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'Finnhub API error' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Quote fetch failed' }, { status: 500 });
  }
}
