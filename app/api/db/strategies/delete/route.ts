// ─── POST /api/db/strategies/delete ───────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { strategyId } = body as { strategyId?: string };
    if (!strategyId) return NextResponse.json({ error: 'strategyId required' }, { status: 400 });

    const { data: existing } = await (supabase as any).from('strategies').select('id, user_id').eq('id', strategyId).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    if (existing.user_id !== authUserId) return NextResponse.json({ error: 'Cannot delete other users strategies' }, { status: 403 });

    const { error } = await (supabase as any).from('strategies').delete().eq('id', strategyId);
    if (error) return NextResponse.json({ error: 'Failed to delete strategy', detail: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
