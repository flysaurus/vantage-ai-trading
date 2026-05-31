// ─── Portfolio History API ──────────────────────────────────
// Returns timestamped equity values for chart rendering.
// Uses per-user broker credentials via broker-service.

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getBrokerContext, makeAlpacaRequest } from '@/lib/broker-service';

export async function GET(req: NextRequest) {
  // Authenticate
  let userId: string;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brokerCtx = await getBrokerContext(userId);

  if (brokerCtx.isDemo || !brokerCtx.credentials || brokerCtx.provider !== 'alpaca') {
    return NextResponse.json(
      { error: brokerCtx.isDemo ? 'Demo mode — connect a broker' : 'Alpaca broker not connected', isDemo: brokerCtx.isDemo },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '1M';
  const timeframe = searchParams.get('timeframe') || '1D';

  try {
    const data = await makeAlpacaRequest(
      `/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}&intraday_reporting=market_hours`,
      brokerCtx.credentials!,
      { signal: AbortSignal.timeout(15000) }
    );

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch portfolio history' }, { status: 502 });
  }
}
