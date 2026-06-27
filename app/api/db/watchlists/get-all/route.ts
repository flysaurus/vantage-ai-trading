// ─── GET /api/db/watchlists/get-all?userId=<id> ───────────────
// Fetches all watchlists for a user.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();

    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('userId') || authUserId;

    if (targetUserId !== authUserId) {
      return NextResponse.json({ error: 'Cannot fetch other users watchlists' }, { status: 403 });
    }

    const { data, error } = await (supabase as any)
      .from('watchlists')
      .select('id, user_id, name, description, stocks, is_default, created_at, updated_at')
      .eq('user_id', targetUserId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[watchlists/get-all] Query failed:', error.message);
      return NextResponse.json({ error: 'Failed to fetch watchlists', detail: error.message }, { status: 500 });
    }

    const watchlists = (data || []).map((w: any) => ({
      id: w.id,
      userId: w.user_id,
      name: w.name,
      description: w.description,
      stocks: w.stocks || [],
      isDefault: w.is_default,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    }));

    return NextResponse.json({ watchlists });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[watchlists/get-all] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
