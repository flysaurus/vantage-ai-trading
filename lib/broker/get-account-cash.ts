// ─── Server-side "settled cash" lookup for guards ───────────────
// Single helper to fetch a user's total settled cash across connected
// SnapTrade brokerages. Used by the DCA create route (and any other
// server-side guard that needs to reject an amount > available cash).
//
// Returns null when there is no connected broker, the fetch fails, or ANY
// connected account failed to report settled cash — callers should treat null
// as "skip the guard" (the broker will reject a true shortfall at execution
// time). A sum that omits an unknown balance is a PARTIAL, not a total; never
// return it as if it were the user's whole cash position.

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
  // A sum that omits an unknown balance is NOT a total — it is a partial that
  // reads as real. Track whether every contributing account reported a number.
  let allKnown = true;

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
      anySuccess = true;
      if (typeof summary.cashBalance === 'number' && Number.isFinite(summary.cashBalance)) {
        totalCash += summary.cashBalance;
      } else {
        // Unknown settled cash ⇒ the user total is unknown, not partial.
        allKnown = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[get-account-cash] account fetch skipped:', msg);
      // A skipped account is an unknown contributor too.
      allKnown = false;
    }
  }

  return anySuccess && allKnown ? Math.max(0, totalCash) : null;
}
