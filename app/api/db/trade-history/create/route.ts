// ─── POST /api/db/trade-history/create ────────────────────────
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

    const { userId, symbol, action, quantity, price, commission, notes, alpacaOrderId, executedAt } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!symbol?.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    if (!action || !['buy', 'sell'].includes(action)) return NextResponse.json({ error: 'action must be buy or sell' }, { status: 400 });
    if (!quantity || quantity <= 0) return NextResponse.json({ error: 'quantity must be positive' }, { status: 400 });
    if (!price || price <= 0) return NextResponse.json({ error: 'price must be positive' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Cannot create trades for other users' }, { status: 403 });

    // Deduplicate by alpaca_order_id
    if (alpacaOrderId) {
      const { data: existing } = await (supabase as any).from('trade_history')
        .select('id, symbol, action, quantity, price, total_value, commission, notes, executed_at, created_at')
        .eq('alpaca_order_id', alpacaOrderId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          id: existing.id, symbol: existing.symbol, action: existing.action,
          quantity: Number(existing.quantity), price: Number(existing.price),
          totalValue: Number(existing.total_value), commission: existing.commission,
          notes: existing.notes, executedAt: existing.executed_at, createdAt: existing.created_at,
          _existing: true,
        });
      }
    }

    const totalValue = quantity * price;
    const execTime = executedAt || new Date().toISOString();

    const { data, error } = await (supabase as any).from('trade_history').insert({
      user_id: userId, symbol: symbol.trim().toUpperCase(),
      side: action, action, qty: quantity, quantity,
      filled_price: price, price, total_value: totalValue,
      commission: commission || 0, notes: notes || null,
      status: 'filled', executed_at: execTime,
      alpaca_order_id: alpacaOrderId || null,
    }).select('id, symbol, action, quantity, price, total_value, commission, notes, executed_at, created_at').single();

    if (error) return NextResponse.json({ error: 'Failed to create trade', detail: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, symbol: data.symbol, action: data.action, quantity: Number(data.quantity), price: Number(data.price), totalValue: Number(data.total_value), commission: data.commission, notes: data.notes, executedAt: data.executed_at, createdAt: data.created_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
