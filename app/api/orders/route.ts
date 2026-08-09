// ─── GET /api/orders ──────────────────────────────────────────
// Returns all orders from public.orders for the authenticated user.
// Merged with broker+trade_history in useOrders hook for the
// complete order history across all sources.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const { data, error, count } = await supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_id', authUser!.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[orders API] Fetch failed:', error);
      return NextResponse.json({ orders: [], total: 0 }, { status: 200 });
    }

    return NextResponse.json({
      orders: (data || []).map(o => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        orderType: o.order_type,
        status: o.status,
        qty: Number(o.qty),
        filledQty: Number(o.filled_qty || 0),
        filledPrice: o.filled_price ? Number(o.filled_price) : undefined,
        filledAt: o.filled_at,
        timeInForce: o.time_in_force,
        isDemo: o.is_demo,
        createdAt: o.created_at,
        brokerageOrderId: o.brokerage_order_id,
        notional: o.notional ? Number(o.notional) : undefined,
      })),
      total: count || 0,
    });
  } catch (err) {
    console.error('[orders API] Error:', err);
    return NextResponse.json({ orders: [], total: 0 }, { status: 200 });
  }
}
