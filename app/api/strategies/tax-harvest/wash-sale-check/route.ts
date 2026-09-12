// GET /api/strategies/tax-harvest/wash-sale-check?symbol=AAPL
// Checks if a symbol was bought in the last 30 days (wash sale rule)

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { scopedConnectionFilter } from '@/lib/tax-harvest/purchase-dates';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  // Optional account scope — the raw SnapTrade connection id (no `snaptrade:`
  // prefix) and/or demo=1. When neither is supplied the query stays user-wide
  // (legacy callers); when supplied it can only see that one account's orders.
  const connectionId = searchParams.get('connectionId') || null;
  const isDemo = searchParams.get('demo') === '1';
  const accountScoped = Boolean(connectionId) || isDemo;

  try {
    const supabase = createServerClient();

    // Check orders table for any buy executed in last 30 days for this symbol
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let buysQuery = (supabase as any)
      .from('orders')
      .select('id, side, symbol, qty, filled_at, created_at, status')
      .eq('user_id', userId)
      .eq('symbol', symbol.toUpperCase())
      .in('side', ['buy', 'BUY', 'buy_to_cover'])
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false });
    buysQuery = scopedConnectionFilter(buysQuery, { connectionId, isDemo });
    const { data: buys, error } = await buysQuery.limit(5);

    if (error && error.code !== 'PGRST116') throw error;

    // Does this account have ANY order history at all? An empty buy list means
    // "no recent buy" only if we actually hold trade history for the account.
    // For a broker position-imported account (no orders ever sent through
    // Vantage) an empty list means "we can't see", NOT "you're clear" — and
    // reporting that as a green "Safe to harvest" would be a claim we can't
    // back. The flag lets the caller label it honestly instead of guessing.
    let historyCount: number | null = null;
    try {
      let historyQuery = (supabase as any)
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      historyQuery = scopedConnectionFilter(historyQuery, { connectionId, isDemo });
      const { count, error: historyError } = await historyQuery;
      if (!historyError && typeof count === 'number') historyCount = count;
    } catch {
      historyCount = null;
    }
    // null = genuinely unknown (query failed) → assume history exists so the
    // legacy "safe" answer is unchanged for callers we can't check.
    const historyAvailable = historyCount === null ? true : historyCount > 0;

    const lastBuy = buys?.[0];
    const hasRecentBuy = buys && buys.length > 0;

    let daysSinceLastTrade: number | null = null;
    if (lastBuy) {
      const tradeDate = new Date(lastBuy.filled_at || lastBuy.created_at);
      daysSinceLastTrade = Math.floor(
        (Date.now() - tradeDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    return NextResponse.json({
      symbol,
      isSafe: !hasRecentBuy,
      historyAvailable,
      daysSinceLastTrade,
      lastTradeDate: lastBuy?.filled_at || lastBuy?.created_at || null,
      recentBuys: buys?.length || 0,
      accountScoped,
    });
  } catch (err: any) {
    console.error('[wash-sale-check] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
