// ─── POST /api/db/trade-history/delete ────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { tradeId } = body as { tradeId?: string };
    if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 });

    const { data: existing } = await (supabase as any).from('trade_history').select('id, user_id').eq('id', tradeId).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    if (existing.user_id !== authUserId) return NextResponse.json({ error: 'Cannot delete other users trades' }, { status: 403 });

    const { error } = await (supabase as any).from('trade_history').delete().eq('id', tradeId);
    if (error) return NextResponse.json({ error: 'Failed to delete trade', detail: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
