// ─── POST /api/strategies/tax-harvesting/execute ────────────
// Executes tax-loss harvesting: sells losing positions and
// optionally buys partner ETFs. Requires connected broker.
// Uses per-user broker credentials via broker-service (Supabase Vault).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { getBrokerContext, makeAlpacaRequest } from '@/lib/broker-service';

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

    // Get broker credentials via broker-service
    const ctx = await getBrokerContext(userId);
    if (ctx.isDemo || !ctx.credentials || ctx.provider !== 'alpaca') {
      return NextResponse.json(
        { error: ctx.isDemo ? 'Demo mode — connect a broker first' : 'Alpaca broker not connected' },
        { status: 400 }
      );
    }

    const creds = ctx.credentials;
    const ordersPlaced: string[] = [];
    const errors: string[] = [];

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

        let sellData: any;
        try {
          sellData = await makeAlpacaRequest('/v2/orders', creds, {
            method: 'POST',
            body: JSON.stringify(sellBody),
          });
        } catch (e: any) {
          errors.push(`SELL ${trade.sellSymbol}: ${e.message}`);
          continue;
        }

        ordersPlaced.push(`SELL:${sellData.id || trade.sellSymbol}`);

        // 2. Buy the replacement ETF if specified
        if (trade.buySymbol) {
          const buyAmount = trade.sellValue || trade.estimatedValue;
          const { getPrice } = await import('@/lib/market-data');
          const buyPrice = (await getPrice(trade.buySymbol)) || 0;

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

              try {
                const buyData: any = await makeAlpacaRequest('/v2/orders', creds, {
                  method: 'POST',
                  body: JSON.stringify(buyBody),
                });
                ordersPlaced.push(`BUY:${buyData.id || trade.buySymbol}`);
              } catch (e: any) {
                errors.push(`BUY ${trade.buySymbol}: ${e.message}`);
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
