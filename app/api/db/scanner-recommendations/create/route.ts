import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { userId, symbol, recommendation, reason } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!symbol?.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    if (!recommendation || !['BUY_MORE', 'HOLD', 'SELL'].includes(recommendation))
      return NextResponse.json({ error: 'recommendation must be BUY_MORE, HOLD, or SELL' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await (supabase as any).from('scanner_recommendations').insert({
      user_id: userId, symbol: symbol.trim().toUpperCase(), recommendation, reason: reason || null,
    }).select('id, symbol, recommendation, reason, created_at').single();
    if (error) return NextResponse.json({ error: 'Failed to create recommendation', detail: error.message }, { status: 500 });
    return NextResponse.json({ id: data.id, symbol: data.symbol, recommendation: data.recommendation, reason: data.reason, createdAt: data.created_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
