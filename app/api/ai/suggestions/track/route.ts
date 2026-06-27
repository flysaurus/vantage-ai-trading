import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const supabase = createServerClient() as any;

    const { data: stale } = await supabase
      .from('ai_suggestions')
      .select('id, symbol, suggested_price, created_at')
      .eq('user_id', userId)
      .is('outcome_30d', null)
      .or(`last_tracked_at.is.null,last_tracked_at.lt.${oneDayAgo}`)
      .limit(20);

    if (!stale?.length) return NextResponse.json({ updated: false, message: 'No stale suggestions' });

    const symbols: string[] = [...new Set((stale as any[]).map((s: any) => (s.symbol as string)))];
    if (!symbols.includes('SPY')) symbols.push('SPY');

    const prices: { symbol: string; price: number }[] = [];
    for (const sym of symbols) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`);
        const data = await res.json() as { c?: number };
        if (data.c != null) prices.push({ symbol: sym, price: data.c });
      } catch {}
    }

    const priceMap = Object.fromEntries(prices.map(p => [p.symbol, p.price]));

    let updated = 0;
    for (const suggestion of stale) {
      const currentPrice = priceMap[suggestion.symbol];
      if (!currentPrice || !suggestion.suggested_price) continue;

      const returnPct = ((currentPrice - suggestion.suggested_price) / suggestion.suggested_price) * 100;
      const daysSince = Math.floor((Date.now() - new Date(suggestion.created_at).getTime()) / 86400000);
      const is30DaysOld = daysSince >= 30;

      const outcome = is30DaysOld
        ? returnPct > 2 ? 'outperformed' : returnPct < -2 ? 'underperformed' : 'neutral'
        : null;

      await supabase
        .from('ai_suggestions')
        .update({
          price_30d: is30DaysOld ? currentPrice : null,
          return_30d: is30DaysOld ? returnPct : null,
          outcome_30d: outcome,
          last_tracked_at: new Date().toISOString()
        })
        .eq('id', suggestion.id);

      updated++;
    }

    return NextResponse.json({ updated: true, count: updated });
  } catch (e: any) {
    return NextResponse.json({ updated: false, error: e.message }, { status: 200 });
  }
}
