// POST /api/strategies/tax-harvest/execute
// Executes tax-loss harvesting: sells losing positions and
// optionally buys replacement securities.
// Uses per-user broker credentials via broker-service (Supabase Vault).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { getBrokerContext, makeAlpacaRequest } from '@/lib/broker-service';

export const maxDuration = 55;

interface HarvestItem {
  symbol: string;
  qty: number;
  costBasis: number;
  currentPrice: number;
  loss: number;
  lossPct: number;
  estTaxSavings: number;
}

interface ReplacementItem {
  symbol: string;
  name: string;
  price: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const { harvests, replacements, taxYear } = body;
    if (!harvests || !Array.isArray(harvests) || harvests.length === 0) {
      return NextResponse.json({ error: 'No harvests provided' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Get broker credentials via broker-service (Supabase Vault)
    const ctx = await getBrokerContext(userId);

    if (ctx.isDemo || !ctx.credentials || ctx.provider !== 'alpaca') {
      return NextResponse.json(
        { error: ctx.isDemo ? 'Demo mode — connect a broker first' : 'Alpaca broker not connected' },
        { status: 400 }
      );
    }

    const creds = ctx.credentials;
    let ordersPlaced = 0;
    const orderIds: string[] = [];
    const errors: string[] = [];
    let totalLossHarvested = 0;

    // Process each harvest
    for (const h of harvests as HarvestItem[]) {
      try {
        // 1. Sell the losing position
        const sellBody = {
          symbol: h.symbol,
          qty: String(h.qty),
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
        };

        let sellOrder: any;
        try {
          sellOrder = await makeAlpacaRequest('/v2/orders', creds, {
            method: 'POST',
            body: JSON.stringify(sellBody),
          });
        } catch (e: any) {
          errors.push(`${h.symbol} sell failed: ${e.message}`);
          continue;
        }

        orderIds.push(sellOrder.id);
        ordersPlaced++;
        totalLossHarvested += h.loss;

        // 2. Buy replacement if selected
        const replacement: ReplacementItem | undefined = replacements?.[h.symbol];
        if (replacement) {
          // Get live price for replacement (multi-source fallback)
          let replPrice = replacement.price;
          try {
            const { getPrice } = await import('@/lib/market-data');
            const livePrice = await getPrice(replacement.symbol);
            if (livePrice) replPrice = livePrice;
          } catch { /* use estimated price */ }

          const buyQty = Math.max(1, Math.floor(h.loss / replPrice));
          const buyBody = {
            symbol: replacement.symbol,
            qty: String(buyQty),
            side: 'buy',
            type: 'market',
            time_in_force: 'day',
          };

          try {
            const buyOrder: any = await makeAlpacaRequest('/v2/orders', creds, {
              method: 'POST',
              body: JSON.stringify(buyBody),
            });
            orderIds.push(buyOrder.id);
            ordersPlaced++;
          } catch (e: any) {
            errors.push(`${replacement.symbol} buy failed: ${e.message}`);
          }
        }
      } catch (e: any) {
        errors.push(`${h.symbol}: ${e.message}`);
      }
    }

    // Record in strategies table
    try {
      await (supabase as any).from('strategies').insert({
        user_id: userId,
        type: 'tax_harvest',
        symbol: null,
        config: {
          harvests: harvests.map((h: HarvestItem) => ({
            symbol: h.symbol,
            qty: h.qty,
            loss: h.loss,
            lossPct: h.lossPct,
          })),
          replacements: replacements || {},
          estimatedSavings: totalLossHarvested * 0.20,
          taxYear: taxYear || new Date().getFullYear(),
          orderIds,
          executedAt: new Date().toISOString(),
        },
        is_active: false,
      });
    } catch (e: any) {
      errors.push(`Record save: ${e.message}`);
    }

    return NextResponse.json({
      success: ordersPlaced > 0,
      ordersPlaced,
      orderIds,
      totalLossHarvested: Math.round(totalLossHarvested * 100) / 100,
      estimatedSavings: Math.round(totalLossHarvested * 0.20 * 100) / 100,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[tax-harvest/execute] Error:', err.message);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
