import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.length < 1) {
    return NextResponse.json({ result: [] });
  }

  const token = process.env.FINNHUB_IO_API_KEY;
  if (!token) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) {
      return NextResponse.json({ error: 'Finnhub API error' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
