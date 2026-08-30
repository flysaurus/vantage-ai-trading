// ─── Server-side "settled cash" lookup for guards ───────────────
// Single helper to fetch a user's total settled cash across connected
// SnapTrade brokerages. Used by the DCA create route (and any other
// server-side guard that needs to reject an amount > available cash).
//
// Returns null when there is no connected broker or the fetch fails —
// callers should treat null as "skip the guard" (the broker will reject
// a true shortfall at execution time).

import { createClient } from '@supabase/supabase-js';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';

export async function getBrokerCashForUser(userId: string): Promise<number | null> {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: connections, error } = await supabaseAdmin
    .from('broker_connections')
    .select('id, brokerage_slug, trading_enabled, snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_connection_id, status')
    .eq('user_id', userId)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'connected');

  if (error) {
    console.error('[get-account-cash] connections query failed:', error.message);
    return null;
  }
  if (!connections || connections.length === 0) return null;

  let totalCash = 0;
  let anySuccess = false;

  for (const conn of connections) {
    try {
      const snapUser = await getOrCreateSnapTradeUser(
        userId,
        conn.snaptrade_user_id,
        conn.snaptrade_user_secret_encrypted,
      );
      const broker = new SnapTradeBroker({
        userId: snapUser.userId,
        userSecret: snapUser.userSecret,
        connectionId: conn.snaptrade_connection_id || '',
        brokerSlug: conn.brokerage_slug,
        brokerName: conn.brokerage_slug,
        tradingEnabled: conn.trading_enabled ?? false,
      });
      const summary = await broker.getAccount();
      totalCash += Number(summary.cashBalance) || 0;
      anySuccess = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[get-account-cash] account fetch skipped:', msg);
    }
  }

  return anySuccess ? Math.max(0, totalCash) : null;
}
