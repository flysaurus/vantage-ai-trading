// ─── GET /api/connections ─────────────────────────────────────
// Returns all connections for the authenticated user.
// DELETE /api/connections/[id] handles disconnects.

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: connections, error } = await supabase
    .from('broker_connections')
    .select(`
      id,
      connection_type,
      brokerage_slug,
      trading_enabled,
      status,
      snaptrade_connection_id,
      snaptrade_accounts,
      created_at,
      updated_at,
      sync_completed_at,
      error_message
    `)
    .eq('user_id', authUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[connections] Fetch error:', error.message);
    return NextResponse.json({ error: 'Failed to load connections' }, { status: 500 });
  }

  // Strip sensitive fields before returning to client
  const sanitized = (connections || []).map((c) => ({
    id: c.id,
    connection_type: c.connection_type,
    brokerage_slug: c.brokerage_slug,
    trading_enabled: c.trading_enabled,
    status: c.status,
    snaptrade_connection_id: c.snaptrade_connection_id,
    accounts: c.snaptrade_accounts || [],
    accountCount: Array.isArray(c.snaptrade_accounts) ? c.snaptrade_accounts.length : 0,
    created_at: c.created_at,
    updated_at: c.updated_at,
    last_synced: c.sync_completed_at,
    error: c.error_message,
  }));

  return NextResponse.json({ connections: sanitized });
}
