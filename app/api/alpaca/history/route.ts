// ─── Portfolio History API ──────────────────────────────────
// Proxies Alpaca's /v2/account/portfolio/history endpoint.
// Returns timestamped equity values for chart rendering.

import { type NextRequest, NextResponse } from 'next/server';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';

export async function GET(req: NextRequest) {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!keyId || !secretKey) {
    return NextResponse.json({ error: 'Alpaca keys not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '1M';
  const timeframe = searchParams.get('timeframe') || '1D';

  try {
    const res = await fetch(
      `${ALPACA_PAPER}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}&intraday_reporting=market_hours`,
      {
        headers: {
          'APCA-API-KEY-ID': keyId,
          'APCA-API-SECRET-KEY': secretKey,
        },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return NextResponse.json({ error: `Alpaca error ${res.status}: ${body.slice(0, 200)}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch portfolio history' }, { status: 502 });
  }
}
