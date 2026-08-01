// ─── Broker Status Endpoint ────────────────────────────────────
// GET /api/broker/status
//
// Returns the current broker connection status and account preview.
// Only supports SnapTrade OAuth connections. Raw API key connections
// have been removed — no credentials are ever sent to the client.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    // ── Check SnapTrade connections first (broker_connections table) ──
    // These are OAuth-based connections that don't store credentials in Vault.
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: snapConn } = await supabaseAdmin
      .from('broker_connections')
      .select('snaptrade_broker_id, brokerage_slug, trading_enabled, snaptrade_accounts, status')
      .eq('user_id', userId)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected')
      .maybeSingle();

    if (snapConn) {
      const accounts = (snapConn.snaptrade_accounts as any[]) || [];
      const totalValue = accounts.reduce((sum: number, a: any) => sum + (a.totalValue || 0), 0);
      const buyingPower = accounts.reduce((sum: number, a: any) => sum + (a.buyingPower || 0), 0);
      const brokerSlug = snapConn.snaptrade_broker_id || snapConn.brokerage_slug || '';
      const isPaper = brokerSlug.toUpperCase().includes('PAPER');

      console.error(
        '[broker/status] SnapTrade connection detected:',
        'brokerSlug:', brokerSlug,
        'accounts:', accounts.length,
        'totalValue:', totalValue,
        'tradingEnabled:', snapConn.trading_enabled
      );

      return NextResponse.json({
        connected: true,
        brokerId: 'snaptrade',
        trading_enabled: snapConn.trading_enabled !== false,
        underlying_broker: brokerSlug,
        accountPreview: {
          id: accounts[0]?.id || 'snaptrade',
          equity: totalValue,
          buyingPower: buyingPower,
          status: 'ACTIVE',
        },
        marketOpen: false,
        environment: isPaper ? 'paper' : 'live',
      });
    }

    // ── No connected broker ──
    return NextResponse.json({
      connected: false,
      brokerId: null,
      accountPreview: null,
      marketOpen: false,
      environment: null,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Status API] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
