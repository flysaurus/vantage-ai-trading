// ─── GET /api/db/trade-history/get-all?userId=&limit=100&offset=0 ─
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
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100'), 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);
    const connectionId = searchParams.get('connectionId');
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Cannot fetch other users trades' }, { status: 403 });

    const base = (supabase as any).from('trade_history').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId);
    const { count } = connectionId ? await base.eq('connection_id', connectionId) : await base;
    let query = (supabase as any).from('trade_history')
      .select('id, symbol, action, quantity, price, total_value, commission, notes, executed_at, created_at')
      .eq('user_id', targetUserId);
    if (connectionId) query = query.eq('connection_id', connectionId);
    const { data, error } = await query.order('executed_at', { ascending: false }).range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: 'Failed to fetch trades', detail: error.message }, { status: 500 });

    return NextResponse.json({
      trades: (data || []).map((t: any) => ({ id: t.id, symbol: t.symbol, action: t.action, quantity: Number(t.quantity), price: Number(t.price), totalValue: Number(t.total_value), commission: t.commission, notes: t.notes, executedAt: t.executed_at, createdAt: t.created_at })),
      total: count || 0,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
