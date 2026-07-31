// ─── DELETE /api/connections/[id] ──────────────────────────────
// Disconnects a broker connection. Removes from both our DB
// and SnapTrade (if applicable).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { deleteConnection, getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';

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
  if (
    conn.connection_type === 'snaptrade' &&
    conn.snaptrade_user_id &&
    conn.snaptrade_user_secret_encrypted &&
    conn.snaptrade_connection_id
  ) {
    try {
      const snapUser = await getOrCreateSnapTradeUser(
        authUser.id,
        conn.snaptrade_user_id,
        conn.snaptrade_user_secret_encrypted,
      );
      await deleteConnection(
        conn.snaptrade_connection_id,
        snapUser.userId,
        snapUser.userSecret,
      );
    } catch (err) {
      console.warn(
        '[connections/delete] SnapTrade deletion failed (non-fatal):',
        err instanceof Error ? err.message : 'Unknown',
      );
      // Continue with local deletion even if SnapTrade deletion fails
    }
  }

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

  return NextResponse.json({ success: true, deleted: id });
}
