import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'SPY';
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';

    const key = process.env.FINNHUB_IO_API_KEY;
    if (!key) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
    }

    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`
    );

    if (!res.ok) {
      return NextResponse.json({ error: `Finnhub returned ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('/api/finnhub/company-news error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
