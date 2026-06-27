// GET /api/strategies/tax-harvest/wash-sale-check?symbol=AAPL
// Checks if a symbol was bought in the last 30 days (wash sale rule)

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  try {
    const supabase = createServerClient();

    // Check orders table for any buy executed in last 30 days for this symbol
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: buys, error } = await (supabase as any)
      .from('orders')
      .select('id, side, symbol, qty, filled_at, created_at, status')
      .eq('user_id', userId)
      .eq('symbol', symbol.toUpperCase())
      .in('side', ['buy', 'BUY', 'buy_to_cover'])
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (error && error.code !== 'PGRST116') throw error;

    const lastBuy = buys?.[0];
    const hasRecentBuy = buys && buys.length > 0;

    let daysSinceLastTrade = Infinity;
    if (lastBuy) {
      const tradeDate = new Date(lastBuy.filled_at || lastBuy.created_at);
      daysSinceLastTrade = Math.floor(
        (Date.now() - tradeDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    return NextResponse.json({
      symbol,
      isSafe: !hasRecentBuy,
      daysSinceLastTrade,
      lastTradeDate: lastBuy?.filled_at || lastBuy?.created_at || null,
      recentBuys: buys?.length || 0,
    });
  } catch (err: any) {
    console.error('[wash-sale-check] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
