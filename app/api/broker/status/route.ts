// ─── Broker Status Endpoint ────────────────────────────────────
// GET /api/broker/status
//
// Returns the current broker connection status and account preview.
// Only supports SnapTrade OAuth connections. Raw API key connections
// have been removed — no credentials are ever sent to the client.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  // Active account's broker_connections.id (stripped of the `snaptrade:` prefix
  // by the client) — lets a multi-broker user get a precise status/preview.
  const requestedConnectionId = req.nextUrl.searchParams.get('connectionId');

  try {
    // ── Canonical resolver — reads LIVE SnapTrade balances ──
    // Requires exactly one connected SnapTrade connection (or an explicit
    // connection id). Ambiguity (2+ connections) with NO explicit id now
    // returns `connected:true, ambiguous:true` (HTTP 200) — the client has a
    // real broker, it just needs to scope per-account calls via the adapter's
    // setConnectionId(). Never "first row wins"; never fail closed to demo.
    const { resolveSnapTradeCredentials, SnapTradeAuthError, SnapTradeAmbiguousError } =
      await import('@/lib/snaptrade/client');
    const { snapTradeFetch } = await import('@/lib/snaptrade/auth');

    let creds;
    try {
      creds = await resolveSnapTradeCredentials(userId, requestedConnectionId);
    } catch (err) {
      if (err instanceof SnapTradeAuthError) {
        // No connected SnapTrade broker — clean "not connected" state.
        return NextResponse.json({
          connected: false,
          brokerId: null,
          accountPreview: null,
          marketOpen: false,
          environment: null,
        });
      }
      if (err instanceof SnapTradeAmbiguousError) {
        return NextResponse.json({
          connected: true,
          brokerId: 'snaptrade',
          ambiguous: true,
          error: err.message,
          connectionId: null,
          accountPreview: null,
          marketOpen: false,
          environment: null,
          trading_enabled: false,
          holdings_available: true,
        });
      }
      throw err;
    }

    const ep = { userId: creds.snaptradeUserId, userSecret: creds.snaptradeUserSecret };

    // Live accounts → total equity + holdings availability + account id
    const accounts = await snapTradeFetch<Array<{
      id: string;
      status?: string;
      balance?: { total?: { amount?: number } };
      sync_status?: { holdings?: { holdings_unavailable?: boolean } };
    }>>(`/authorizations/${creds.connectionId}/accounts`, null, ep);

    let totalValue = 0;
    let buyingPower = 0;
    let holdingsAvailable = true;
    let accountId = 'snaptrade';

    if (Array.isArray(accounts) && accounts.length > 0) {
      accountId = accounts[0]?.id || 'snaptrade';
      for (const acct of accounts) {
        totalValue += Number(acct.balance?.total?.amount || 0);
        if (acct.sync_status?.holdings?.holdings_unavailable) holdingsAvailable = false;
      }
      // Live per-account balances → real buying power (fixes stale $32K cache)
      for (const acct of accounts) {
        try {
          const balances = await snapTradeFetch<Array<{ cash?: number; buying_power?: number }>>(
            `/accounts/${acct.id}/balances`, null, ep,
          );
          if (Array.isArray(balances)) {
            for (const b of balances) buyingPower += Number(b.buying_power || 0);
          }
        } catch { /* partial failure OK */ }
      }
    }

    const brokerSlug = creds.brokerSlug || '';
    const isPaper = brokerSlug.toUpperCase().includes('PAPER');

    console.error(
      '[broker/status] SnapTrade connection detected:',
      'brokerSlug:', brokerSlug,
      'accounts:', Array.isArray(accounts) ? accounts.length : 0,
      'totalValue:', totalValue,
      'buyingPower:', buyingPower,
      'tradingEnabled:', creds.tradingEnabled,
      'holdingsAvailable:', holdingsAvailable,
    );

    return NextResponse.json({
      connected: true,
      brokerId: 'snaptrade',
      connectionId: creds.brokerConnectionId,
      trading_enabled: creds.tradingEnabled,
      holdings_available: holdingsAvailable,
      underlying_broker: brokerSlug,
      accountPreview: {
        id: accountId,
        equity: totalValue,
        buyingPower: buyingPower || null,
        status: 'ACTIVE',
      },
      marketOpen: false,
      environment: isPaper ? 'paper' : 'live',
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
