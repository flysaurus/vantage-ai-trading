// ─── GET /api/db/trade-history/get-single?id=<tradeId> ────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { TRADE_HISTORY_SELECT, toTradeRecord } from '@/lib/db/trade-history';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const tradeId = req.nextUrl.searchParams.get('id');
    if (!tradeId) return NextResponse.json({ error: 'id (tradeId) required' }, { status: 400 });

    const { data, error } = await (supabase as any).from('trade_history')
      .select(TRADE_HISTORY_SELECT)
      .eq('id', tradeId).maybeSingle();

    if (error) return NextResponse.json({ error: 'Failed to fetch trade', detail: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    if (data.user_id !== authUserId) return NextResponse.json({ error: 'Cannot read other users trades' }, { status: 403 });

    return NextResponse.json(toTradeRecord(data));
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
