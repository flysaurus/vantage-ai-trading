// POST /api/strategies/rebalancing/save-queue
// Saves the rebalancing order queue with edits for later execution

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const { orders, summary } = body;
    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json({ error: 'orders array required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Deactivate any previous queue
    await (supabase as any)
      .from('strategies')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('type', 'rebalance_queue');

    // Insert new queue
    await (supabase as any).from('strategies').insert({
      user_id: userId,
      type: 'rebalance_queue',
      symbol: null,
      config: {
        orders: orders.map((o: any) => ({
          symbol: o.symbol,
          action: o.action,
          shares: o.shares,
          estimatedValue: o.estimatedValue,
          orderType: o.orderType || 'market',
          limitPrice: o.limitPrice || null,
        })),
        summary: summary || {},
        savedAt: new Date().toISOString(),
      },
      is_active: true,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[save-queue] Error:', err.message);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
