// ─── POST /api/broker/execute-trade ──────────────────────────
// Server-side proxy: resolves SnapTrade credentials, creates a
// SnapTradeBroker, and calls placeOrder(). This keeps SnapTrade
// credentials server-side while allowing the client to execute
// real trades through the NEW broker engine (not the old stub).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';

function formatBrokerName(slug: string | null): string {
  if (!slug) return 'Unknown';
  return slug
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: {
    symbol: string;
    side: 'BUY' | 'SELL';
    shares: number;
    orderType?: 'market' | 'limit' | 'stop' | 'stop_limit';
    /** Optional dollar amount (AI trades default to $500)*/
    dollarAmount?: number;
    limitPrice?: number;
    stopPrice?: number;
    timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const { symbol, side, shares, orderType, dollarAmount, limitPrice, stopPrice, timeInForce } = body;

  if (!symbol || !side || (shares == null && dollarAmount == null)) {
    return NextResponse.json(
      { success: false, error: 'Missing required fields: symbol, side, and shares or dollarAmount' },
      { status: 400 },
    );
  }

  // --- Resolve credentials + connection metadata ---
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let connectionId: string;
  let brokerSlug: string;
  let tradingEnabled: boolean = false;

  try {
    const creds = await resolveSnapTradeCredentials(authUser!.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    connectionId = creds.connectionId;
    brokerSlug = creds.brokerSlug;

    // Also query the trading_enabled flag from the DB
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: conn } = await supabase
      .from('broker_connections')
      .select('trading_enabled')
      .eq('user_id', authUser!.id)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected')
      .maybeSingle();

    tradingEnabled = conn?.trading_enabled === true;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, status: 'REJECTED' },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to load brokerage credentials.', status: 'REJECTED' },
      { status: 502 },
    );
  }

  // --- Place the order ---
  try {
    const broker = new SnapTradeBroker({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
      connectionId,
      brokerSlug,
      brokerName: formatBrokerName(brokerSlug),
      tradingEnabled,
    });

    const result = await broker.placeOrder({
      symbol,
      side,
      type: orderType || 'market',
      shares,
      dollarAmount,
      limitPrice,
      stopPrice,
      timeInForce: timeInForce || 'day',
    });

    return NextResponse.json({
      success: result.success,
      status: result.status,
      orderId: result.orderId,
      message: result.message,
      fillPrice: result.fillPrice,
      totalCost: result.totalCost,
      filledShares: result.filledShares,
      filledAt: result.filledAt,
    });
  } catch (err) {
    const msg = (err as Error).message || 'Trade execution failed';
    console.error('[execute-trade] Error:', msg);
    return NextResponse.json(
      { success: false, error: msg, status: 'REJECTED' },
      { status: 502 },
    );
  }
}
