// ─── GET /api/snaptrade/portfolio ─────────────────────────────
// Returns positions + account summary for a SnapTrade connection.
// Fully generic — works for any broker via the connection stored in
// broker_connections, not hardcoded to any specific brokerage.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { formatBrokerName } from '@/lib/broker-name';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: conn } = await supabaseAdmin
      .from('broker_connections')
      .select('*')
      .eq('user_id', authUser!.id)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected')
      .maybeSingle();

    if (
      !conn?.snaptrade_user_id ||
      !conn?.snaptrade_user_secret_encrypted ||
      !conn?.snaptrade_connection_id
    ) {
      return NextResponse.json({ error: 'No active SnapTrade connection' }, { status: 404 });
    }

    // Decrypt user secret
    const snapUser = await getOrCreateSnapTradeUser(
      authUser!.id,
      conn.snaptrade_user_id,
      conn.snaptrade_user_secret_encrypted,
    );

    const broker = new SnapTradeBroker({
      userId: snapUser.userId,
      userSecret: snapUser.userSecret,
      connectionId: conn.snaptrade_connection_id,
      brokerSlug: conn.brokerage_slug || 'UNKNOWN',
      brokerName: formatBrokerName(conn.brokerage_slug),
      tradingEnabled: conn.trading_enabled ?? false,
    });

    const [account, positions] = await Promise.all([
      broker.getAccount().catch((err) => {
        console.error('[snaptrade/portfolio] Account fetch failed:', err);
        return null;
      }),
      broker.getPositions().catch((err) => {
        console.error('[snaptrade/portfolio] Positions fetch failed:', err);
        return null;
      }),
    ]);

    return NextResponse.json({
      account,
      positions: positions || [],
      broker: {
        slug: conn.brokerage_slug,
        name: formatBrokerName(conn.brokerage_slug),
        tradingEnabled: conn.trading_enabled ?? false,
      },
    });
  } catch (err) {
    console.error('[snaptrade/portfolio] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


