// ─── POST /api/broker/disconnect ─────────────────────────
// Disconnects the current broker and resets to demo mode.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { purgeConnectionDerivedData } from '@/lib/broker/purge-connection-data';
import { revokeConnection, getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';

export async function POST(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    // Read the connection ids BEFORE deleting, then purge every derived row
    // tied to them (noticed cards, cached insights, positions, orders, lots,
    // briefs, chat history…). Previously only the broker_connections row was
    // removed and all of this lingered — the source of "stale card from a
    // deleted account".
    const { data: conns } = await supabase
      .from('broker_connections')
      .select('id, connection_type, snaptrade_user_id, snaptrade_user_secret_encrypted, snaptrade_connection_id')
      .eq('user_id', authUser.id);
    const rows = (conns || []) as any[];
    const connectionIds = rows.map((c) => c.id);

    // Disconnect at the broker level too. Without this the SnapTrade
    // authorization stayed alive and kept returning its accounts, so a
    // "disconnected" broker reappeared on the next load — the same
    // half-deleted state the account route used to aggregate into a total.
    let snaptradeDisconnected = 0;
    const snaptradeRevoke: Array<{ id: string; ok: boolean; status: number; error: string | null }> = [];
    for (const c of rows) {
      if (
        c.connection_type !== 'snaptrade' ||
        !c.snaptrade_user_id ||
        !c.snaptrade_user_secret_encrypted ||
        !c.snaptrade_connection_id
      ) {
        continue;
      }
      try {
        const snapUser = await getOrCreateSnapTradeUser(
          authUser.id,
          c.snaptrade_user_id,
          c.snaptrade_user_secret_encrypted,
        );
        const rev = await revokeConnection(c.snaptrade_connection_id, snapUser.userId, snapUser.userSecret);
        snaptradeRevoke.push({ id: c.snaptrade_connection_id, ok: rev.ok, status: rev.status, error: rev.error });
        if (rev.ok) {
          snaptradeDisconnected += 1;
          console.log(`[Disconnect] SnapTrade revoked authorization ${c.snaptrade_connection_id} → ${rev.status}`);
        } else {
          console.warn(`[Disconnect] SnapTrade revoke FAILED for ${c.snaptrade_connection_id}: ${rev.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown';
        snaptradeRevoke.push({ id: c.snaptrade_connection_id, ok: false, status: 0, error: msg });
        console.warn('[Disconnect] SnapTrade deletion failed (non-fatal):', msg);
      }
    }

    await purgeConnectionDerivedData(supabase, authUser.id, connectionIds);

    // Clear broker_connections
    await supabase
      .from('broker_connections')
      .delete()
      .eq('user_id', authUser.id);

    // Reset users table
    await supabase
      .from('users')
      .update({
        connection_type: null,
        connection_status: null,
        broker_connected: false,
        portfolio_mode: 'demo',
      })
      .eq('id', authUser.id);

    return NextResponse.json({ success: true, snaptradeDisconnected, snaptradeRevoke });
  } catch (err) {
    console.error('[Disconnect] Error:', err);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
