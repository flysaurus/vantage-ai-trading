// ─── POST /api/broker/disconnect ─────────────────────────
// Disconnects the current broker and resets to demo mode.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { purgeConnectionDerivedData } from '@/lib/broker/purge-connection-data';

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
      .select('id')
      .eq('user_id', authUser.id);
    const connectionIds = (conns || []).map((c: any) => c.id);
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Disconnect] Error:', err);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
