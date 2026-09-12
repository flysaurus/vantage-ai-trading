// ─── POST /api/db/trade-history/create ────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { TRADE_HISTORY_SELECT, toTradeRecord, toTradeInsert } from '@/lib/db/trade-history';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { userId, symbol, action, quantity, price, commission, notes, alpacaOrderId, executedAt, connectionId, isDemo } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!symbol?.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    if (!action || !['buy', 'sell'].includes(action)) return NextResponse.json({ error: 'action must be buy or sell' }, { status: 400 });
    if (!quantity || quantity <= 0) return NextResponse.json({ error: 'quantity must be positive' }, { status: 400 });
    if (!price || price <= 0) return NextResponse.json({ error: 'price must be positive' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Cannot create trades for other users' }, { status: 403 });

    // Deduplicate. There is no broker-order-id column, so an order is matched
    // on what it is: same symbol/side/size/price/execution time for the same
    // user. (This used to select `alpaca_order_id` + `total_value`, neither of
    // which exists — the query errored and the dedupe never ran.)
    const execTime = executedAt || new Date().toISOString();
    const { data: existing } = await (supabase as any).from('trade_history')
      .select(TRADE_HISTORY_SELECT)
      .eq('user_id', userId)
      .eq('symbol', symbol.trim().toUpperCase())
      .eq('action', action)
      .eq('quantity', quantity)
      .eq('price', price)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ...toTradeRecord(existing), _existing: true });
    }

    const { data, error } = await (supabase as any).from('trade_history')
      .insert(toTradeInsert(
        { symbol, action, quantity, price, commission, notes, executedAt: execTime },
        { userId, connectionId: connectionId || null, isDemo },
      ))
      .select(TRADE_HISTORY_SELECT)
      .single();

    if (error) return NextResponse.json({ error: 'Failed to create trade', detail: error.message }, { status: 500 });

    return NextResponse.json(toTradeRecord(data));
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
