// ─── DELETE /api/connections/[id] ──────────────────────────────
// Disconnects a broker connection. Removes from both our DB
// and SnapTrade (if applicable).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { revokeConnection, getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';
import { purgeConnectionDerivedData } from '@/lib/broker/purge-connection-data';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const { id } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Fetch connection (verify ownership) ──
  const { data: conn, error: fetchErr } = await supabase
    .from('broker_connections')
    .select('*')
    .eq('id', id)
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (fetchErr || !conn) {
    return NextResponse.json(
      { error: 'Connection not found' },
      { status: 404 },
    );
  }

  // ── Delete from SnapTrade if applicable ──
  // This is the REAL disconnect: removes the authorization at the broker
  // aggregator, so the login stops returning its accounts entirely.
  // The API outcome is captured (not just a boolean) so the response can prove
  // the revoke really happened at SnapTrade, not merely that our row is gone.
  let snaptradeDisconnected = false;
  let snaptradeRevoke: { attempted: boolean; ok: boolean; status: number | null; error: string | null } =
    { attempted: false, ok: false, status: null, error: null };
  if (
    conn.connection_type === 'snaptrade' &&
    conn.snaptrade_user_id &&
    conn.snaptrade_user_secret_encrypted &&
    conn.snaptrade_connection_id
  ) {
    snaptradeRevoke.attempted = true;
    try {
      const snapUser = await getOrCreateSnapTradeUser(
        authUser.id,
        conn.snaptrade_user_id,
        conn.snaptrade_user_secret_encrypted,
      );
      const rev = await revokeConnection(
        conn.snaptrade_connection_id,
        snapUser.userId,
        snapUser.userSecret,
      );
      snaptradeRevoke.ok = rev.ok;
      snaptradeRevoke.status = rev.status;
      snaptradeRevoke.error = rev.error;
      if (rev.ok) {
        snaptradeDisconnected = true;
        console.log(
          `[connections/delete] SnapTrade revoked authorization ${conn.snaptrade_connection_id} → ${rev.status}`,
        );
      } else {
        console.warn(
          `[connections/delete] SnapTrade revoke FAILED for ${conn.snaptrade_connection_id}: ${rev.error}`,
        );
      }
    } catch (err) {
      snaptradeRevoke.error = err instanceof Error ? err.message : 'Unknown';
      console.warn(
        '[connections/delete] SnapTrade deletion failed (non-fatal):',
        snaptradeRevoke.error,
      );
      // Continue with local deletion even if SnapTrade deletion fails
    }
  }

  // ── Purge ALL derived data tied to this connection ──
  // Deleting only the broker_connections row left every derived row behind
  // (Noticed cards, positions, lots, briefs, chat context) — the cause of the
  // "stale card from a deleted account" bug. Purge is scoped by user_id AND
  // connection id; it never touches broker_connections itself.
  const purge = await purgeConnectionDerivedData(supabase, authUser.id, [id]);

  // ── Delete from our DB ──
  const { error: deleteErr } = await supabase
    .from('broker_connections')
    .delete()
    .eq('id', id)
    .eq('user_id', authUser.id);

  if (deleteErr) {
    console.error('[connections/delete] DB deletion error:', deleteErr.message);
    return NextResponse.json({ error: 'Failed to delete connection' }, { status: 500 });
  }

  // ── Update users table ──
  // Check if they have remaining connections
  const { count } = await supabase
    .from('broker_connections')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', authUser.id)
    .neq('id', id);

  if (count === 0) {
    await supabase
      .from('users')
      .update({
        connection_type: null,
        connection_status: 'disconnected',
      })
      .eq('id', authUser.id);
  }

  return NextResponse.json({
    success: true,
    deleted: id,
    // Surfaced so the UI/acceptance test can assert the authorization is
    // actually gone, not merely hidden from Vantage's list.
    snaptradeDisconnected,
    // Raw SnapTrade revoke outcome (attempted / HTTP status / error detail).
    snaptradeRevoke,
    purgedRows: purge.purgedDeletes,
  });
}
