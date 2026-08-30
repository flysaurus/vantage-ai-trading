// ─── POST /api/db/watchlists/delete ──────────────────────────
// Deletes an entire watchlist (and all its stocks).
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { accountScopeMatches } from '@/lib/account-scope';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { watchlistId, accountId } = body as { watchlistId?: string; accountId?: string };
    if (!watchlistId) {
      return NextResponse.json({ error: 'watchlistId required' }, { status: 400 });
    }

    // Verify ownership
    const { data: existing, error: fetchErr } = await (supabase as any)
      .from('watchlists')
      .select('id, user_id, connection_id, is_demo')
      .eq('id', watchlistId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 });
    }
    if (existing.user_id !== authUserId) {
      return NextResponse.json({ error: 'Cannot delete other users watchlists' }, { status: 403 });
    }
    if (!accountScopeMatches(accountId, existing)) {
      return NextResponse.json({ error: 'Watchlist not found for this account' }, { status: 404 });
    }

    const { error } = await (supabase as any)
      .from('watchlists')
      .delete()
      .eq('id', watchlistId);

    if (error) {
      console.error('[watchlists/delete] Delete failed:', error.message);
      return NextResponse.json({ error: 'Failed to delete watchlist', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[watchlists/delete] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
