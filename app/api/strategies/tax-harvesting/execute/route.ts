// ─── POST /api/strategies/tax-harvesting/execute ────────────
// Executes tax-loss harvesting: sells losing positions and
// optionally buys partner ETFs. Requires connected broker.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

interface HarvestTrade {
  sellSymbol: string;
  sellShares: number;
  sellValue: number;
  buySymbol: string | null;
  buyName: string | null;
  estimatedValue: number;
  lossRealized: number;
}

export const maxDuration = 55;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: any) {
    return NextResponse.json({ error: 'Unauthorized', detail: err?.message }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.trades) || body.trades.length === 0) {
      return NextResponse.json({ error: 'No trades to execute' }, { status: 400 });
    }

    const { trades } = body as { trades: HarvestTrade[] };

    // Validate
    for (const t of trades) {
      if (!t.sellSymbol || !t.sellShares || t.sellShares <= 0) {
        return NextResponse.json({ error: `Invalid trade: ${JSON.stringify(t)}` }, { status: 400 });
      }
    }

    const ordersPlaced: string[] = [];
    const errors: string[] = [];
    const cookie = req.headers.get('cookie') || '';

    for (const trade of trades) {
      try {
        // 1. Sell the losing position
        const sellBody: any = {
          symbol: trade.sellSymbol.toUpperCase(),
          qty: trade.sellShares,
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
        };

        const sellRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/alpaca/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify(sellBody),
        });

        if (!sellRes.ok) {
          const errData = await sellRes.json().catch(() => ({}));
          errors.push(`SELL ${trade.sellSymbol}: ${errData.error || errData.message || sellRes.statusText}`);
          continue; // skip the buy if sell failed
        }

        const sellData = await sellRes.json();
        ordersPlaced.push(`SELL:${sellData.id || trade.sellSymbol}`);

        // 2. Buy the replacement ETF if specified
        if (trade.buySymbol) {
          const buyAmount = trade.sellValue || trade.estimatedValue;
          const res = await fetch(
            `https://finnhub.io/api/v1/quote?symbol=${trade.buySymbol}&token=${process.env.FINNHUB_IO_API_KEY || ''}`,
          );
          let buyPrice = 0;
          if (res.ok) {
            const q = await res.json();
            buyPrice = q.c || 0;
          }

          if (buyPrice > 0) {
            const buyShares = Math.floor((buyAmount / buyPrice) * 100) / 100;

            if (buyShares > 0) {
              const buyBody: any = {
                symbol: trade.buySymbol.toUpperCase(),
                qty: buyShares,
                side: 'buy',
                type: 'market',
                time_in_force: 'day',
              };

              const buyRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/alpaca/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: cookie },
                body: JSON.stringify(buyBody),
              });

              if (buyRes.ok) {
                const buyData = await buyRes.json();
                ordersPlaced.push(`BUY:${buyData.id || trade.buySymbol}`);
              } else {
                const errData = await buyRes.json().catch(() => ({}));
                errors.push(`BUY ${trade.buySymbol}: ${errData.error || errData.message || buyRes.statusText}`);
              }
            }
          } else {
            errors.push(`BUY ${trade.buySymbol}: Could not fetch price`);
          }
        }
      } catch (e: any) {
        errors.push(`${trade.sellSymbol}: ${e.message}`);
      }
    }

    // Save record to strategies table
    try {
      await (supabase as any).from('strategies').insert({
        user_id: userId,
        type: 'tax-harvest',
        symbol: null,
        config: {
          trades: trades.map(t => ({
            sellSymbol: t.sellSymbol,
            sellShares: t.sellShares,
            buySymbol: t.buySymbol,
            lossRealized: t.lossRealized,
          })),
        },
        is_active: false,
      });
    } catch (dbErr: any) {
      console.error('[tax-harvest] Failed to save record:', dbErr.message);
    }

    return NextResponse.json({
      success: true,
      ordersPlaced: ordersPlaced.length,
      orderIds: ordersPlaced,
      totalLossHarvested: trades.reduce((s, t) => s + t.lossRealized, 0),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
