// ─── GET /api/db/trade-history/get-all?userId=&limit=100&offset=0 ─
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('userId') || authUserId;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100'), 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Cannot fetch other users trades' }, { status: 403 });

    const { count } = await (supabase as any).from('trade_history').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId);
    const { data, error } = await (supabase as any).from('trade_history')
      .select('id, symbol, action, quantity, price, total_value, commission, notes, executed_at, created_at')
      .eq('user_id', targetUserId).order('executed_at', { ascending: false }).range(offset, offset + limit - 1);

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
