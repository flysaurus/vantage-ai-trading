// ─── POST /api/db/trade-history/create ────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });

    const { userId, symbol, action, quantity, price, commission, notes } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!symbol?.trim()) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    if (!action || !['buy', 'sell'].includes(action)) return NextResponse.json({ error: 'action must be buy or sell' }, { status: 400 });
    if (!quantity || quantity <= 0) return NextResponse.json({ error: 'quantity must be positive' }, { status: 400 });
    if (!price || price <= 0) return NextResponse.json({ error: 'price must be positive' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Cannot create trades for other users' }, { status: 403 });

    const totalValue = quantity * price;
    const now = new Date().toISOString();

    const { data, error } = await (supabase as any).from('trade_history').insert({
      user_id: userId, symbol: symbol.trim().toUpperCase(),
      side: action, action, qty: quantity, quantity,
      filled_price: price, price, total_value: totalValue,
      commission: commission || 0, notes: notes || null,
      status: 'filled', executed_at: now,
    }).select('id, symbol, action, quantity, price, total_value, commission, notes, executed_at, created_at').single();

    if (error) return NextResponse.json({ error: 'Failed to create trade', detail: error.message }, { status: 500 });

    return NextResponse.json({ id: data.id, symbol: data.symbol, action: data.action, quantity: Number(data.quantity), price: Number(data.price), totalValue: Number(data.total_value), commission: data.commission, notes: data.notes, executedAt: data.executed_at, createdAt: data.created_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
