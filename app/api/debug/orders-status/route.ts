// ─── GET /api/debug/orders-status ─────────────────────────
// Diagnostic endpoint: shows exactly what /api/broker/snaptrade/orders returns
// plus environment config status. Hit this in your browser, paste the raw JSON.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import { resolveSnapTradeCredentials, SnapTradeAuthError } from '@/lib/snaptrade/client';
import { extractOrderSymbol, extractOrderName, mapOrderSide } from '@/lib/snaptrade/mapping';

const TRADE_TYPES = new Set(['BUY', 'SELL', 'SELL_SHORT', 'BUY_TO_COVER', 'DIVIDEND_REINVEST']);

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const diagnostic: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    userId: authUser!.id,
    hasSnaptradeClientId: !!process.env.SNAPTRADE_CLIENT_ID,
    hasSnaptradeConsumerKey: !!process.env.SNAPTRADE_CONSUMER_KEY,
  };

  // ── Step 1: Check broker_connections ──
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: connections, error: connErr } = await supabase
    .from('broker_connections')
    .select('id, brokerage_slug, connection_type, status, snaptrade_connection_id')
    .eq('user_id', authUser!.id);

  diagnostic.connectionCount = connections?.length ?? 0;
  diagnostic.connectionsError = connErr?.message ?? null;
  diagnostic.connections = connections?.map(c => ({
    id: c.id,
    slug: c.brokerage_slug,
    type: c.connection_type,
    status: c.status,
    connectionId: c.snaptrade_connection_id,
  }));

  // ── Step 2: Try to resolve SnapTrade credentials ──
  let credentialResolve = 'not attempted';
  let snaptradeUserId = '';
  let snaptradeUserSecret = '';
  let authorizationId = '';

  try {
    const creds = await resolveSnapTradeCredentials(authUser!.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    authorizationId = creds.connectionId;
    credentialResolve = 'success';
  } catch (err) {
    credentialResolve = `error: ${err instanceof Error ? err.message : String(err)}`;
    diagnostic.credentialError = credentialResolve;
    return NextResponse.json(diagnostic);
  }

  diagnostic.snaptradeUserId = snaptradeUserId.substring(0, 8) + '...';
  diagnostic.authorizationId = authorizationId.substring(0, 8) + '...';
  diagnostic.credentialResolve = credentialResolve;

  // ── Step 3: If no SNAPTRADE_CLIENT_ID, show what DEV would return ──
  if (!process.env.SNAPTRADE_CLIENT_ID) {
    diagnostic.mode = 'DEV';
    diagnostic.note = 'SNAPTRADE_CLIENT_ID not set — route returns synthetic DEV_ORDERS';
    // Import the actual DEV_ORDERS from the route
    const devOrders = [
      { id: 'dev-order-001', symbol: 'AAPL', side: 'buy', status: 'filled', qty: 10 },
      { id: 'dev-order-002', symbol: 'MSFT', side: 'buy', status: 'filled', qty: 5 },
      { id: 'dev-order-003', symbol: 'NVDA', side: 'sell', status: 'cancelled', qty: 3 },
      { id: 'dev-order-004', symbol: 'SPY', side: 'sell', status: 'filled', qty: 2 },
    ];
    diagnostic.devOrdersCount = devOrders.length;
    diagnostic.devOrders = devOrders;
    diagnostic.filledCount = devOrders.filter(o => o.status === 'filled').length;
    return NextResponse.json(diagnostic);
  }

  // ── Step 4: Fetch real data ──
  diagnostic.mode = 'LIVE';
  const extraParams = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };

  try {
    // List accounts
    const accounts = await snapTradeFetch<{ id: string; name: string }[]>(
      `/authorizations/${authorizationId}/accounts`,
      null,
      extraParams,
    );

    diagnostic.accountCount = Array.isArray(accounts) ? accounts.length : 0;
    diagnostic.accounts = Array.isArray(accounts)
      ? accounts.map(a => ({ id: a.id, name: a.name }))
      : [];

    if (!Array.isArray(accounts) || accounts.length === 0) {
      diagnostic.ordersCount = 0;
      diagnostic.orders = [];
      return NextResponse.json(diagnostic);
    }

    // Fetch activities for each account
    const allOrders: unknown[] = [];
    const seenIds = new Set<string>();
    const rawActivityCounts: Record<string, number> = {};
    const mappingResults: Record<string, { total: number; mapped: number; skipped: { type: string; reason: string }[] }> = {};

    for (const account of accounts) {
      try {
        const activities = await snapTradeFetch<Record<string, unknown>[]>(
          `/accounts/${account.id}/activities`,
          null,
          extraParams,
        );

        rawActivityCounts[account.id] = Array.isArray(activities) ? activities.length : 0;
        const skipped: { type: string; reason: string }[] = [];

        if (Array.isArray(activities)) {
          for (const activity of activities) {
            const symbol = extractOrderSymbol(activity);
            const type = (activity as any).type || 'unknown';

            if (!symbol) {
              skipped.push({ type, reason: 'no_symbol' });
              continue;
            }
            if (!TRADE_TYPES.has(type)) {
              skipped.push({ type, reason: 'non_trade_type' });
              continue;
            }

            const uniqueId = (activity as any).id
              ? `snaptrade-${account.id}-${(activity as any).id}`
              : `snaptrade-${account.id}-${symbol}-${(activity as any).trade_date}-${type}`;

            if (seenIds.has(uniqueId)) continue;
            seenIds.add(uniqueId);

            const qty = Math.abs((activity as any).units || 0);
            allOrders.push({
              id: uniqueId,
              symbol,
              name: extractOrderName(activity) || symbol,
              side: mapOrderSide(type),
              type: 'market',
              status: 'filled',
              qty,
              filledQty: qty,
              filledPrice: (activity as any).price || 0,
              totalValue: Math.abs((activity as any).amount || qty * ((activity as any).price || 0)),
              createdAt: (activity as any).trade_date,
              tradeType: type,
            });
          }
        }

        mappingResults[account.id] = {
          total: Array.isArray(activities) ? activities.length : 0,
          mapped: mappingResults[account.id]?.mapped ?? 0,
          skipped,
        };
        // Recalculate mapped count
        const totalActivities = Array.isArray(activities) ? activities.length : 0;
        mappingResults[account.id].total = totalActivities;
        mappingResults[account.id].mapped = totalActivities - skipped.length;
      } catch (err) {
        rawActivityCounts[account.id] = -1;
        mappingResults[account.id] = {
          total: 0,
          mapped: 0,
          skipped: [{ type: 'error', reason: (err as Error).message }],
        };
      }
    }

    diagnostic.rawActivityCounts = rawActivityCounts;
    diagnostic.mappingResults = mappingResults;
    diagnostic.ordersCount = allOrders.length;
    diagnostic.filledCount = allOrders.filter((o: any) => o.status === 'filled').length;
    diagnostic.orders = allOrders;

    return NextResponse.json(diagnostic);
  } catch (err) {
    diagnostic.fetchError = (err as Error).message;
    return NextResponse.json(diagnostic);
  }
}
