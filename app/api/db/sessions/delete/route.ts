import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { sessionId, userId } = body as { sessionId?: string; userId?: string };
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data: existing } = await (supabase as any).from('sessions').select('id, user_id').eq('id', sessionId).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    if (existing.user_id !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { error } = await (supabase as any).from('sessions').delete().eq('id', sessionId);
    if (error) return NextResponse.json({ error: 'Failed to delete session', detail: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
