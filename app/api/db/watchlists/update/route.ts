// ─── POST /api/db/watchlists/update ──────────────────────────
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
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { watchlistId, name, description, accountId } = body as { watchlistId?: string; name?: string; description?: string; accountId?: string };
    if (!watchlistId) return NextResponse.json({ error: 'watchlistId required' }, { status: 400 });
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const { data: existing } = await (supabase as any)
      .from('watchlists').select('id, user_id, connection_id, is_demo').eq('id', watchlistId).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 });
    if (existing.user_id !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!accountScopeMatches(accountId, existing)) return NextResponse.json({ error: 'Watchlist not found for this account' }, { status: 404 });

    const updates: Record<string, unknown> = { name: name.trim(), updated_at: new Date().toISOString() };
    if (description !== undefined) updates.description = description?.trim() || null;

    const { data, error } = await (supabase as any).from('watchlists')
      .update(updates).eq('id', watchlistId)
      .select('id, name, description, updated_at').single();
    if (error) return NextResponse.json({ error: 'Failed to update watchlist', detail: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, name: data.name, description: data.description, updatedAt: data.updated_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
