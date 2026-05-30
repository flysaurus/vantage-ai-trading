// POST /api/strategies/tax-harvest/execute
// Executes tax-loss harvesting: sells losing positions and
// optionally buys replacement securities.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { decryptData } from '@/lib/crypto';

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
  let userId: string;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const { harvests, replacements, taxYear } = body;
    if (!harvests || !Array.isArray(harvests) || harvests.length === 0) {
      return NextResponse.json({ error: 'No harvests provided' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Get broker credentials from vault
    const authCookie = req.cookies.get('sb-vantage-auth-token')?.value;
    if (!authCookie) {
      return NextResponse.json({ error: 'No auth cookie' }, { status: 401 });
    }

    const { data: vault } = await (supabase as any)
      .from('broker_vault')
      .select('encrypted_config')
      .eq('user_id', userId)
      .eq('broker', 'alpaca')
      .single();

    if (!(vault as any)?.encrypted_config) {
      return NextResponse.json({ error: 'Broker not connected' }, { status: 400 });
    }

    const decrypted = decryptData(vault.encrypted_config);
    const { apiKey, apiSecret, paper } = JSON.parse(decrypted);
    const baseUrl = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    let ordersPlaced = 0;
    const orderIds: string[] = [];
    const errors: string[] = [];
    let totalLossHarvested = 0;

    // Process each harvest
    for (const h of harvests as HarvestItem[]) {
      try {
        // 1. Sell the losing position
        const sellBody = JSON.stringify({
          symbol: h.symbol,
          qty: String(h.qty),
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
        });

        const sellRes = await fetch(`${baseUrl}/v2/orders`, {
          method: 'POST',
          headers: {
            'APCA-API-KEY-ID': apiKey,
            'APCA-API-SECRET-KEY': apiSecret,
            'Content-Type': 'application/json',
          },
          body: sellBody,
        });

        if (!sellRes.ok) {
          const errBody = await sellRes.text();
          errors.push(`${h.symbol} sell failed: ${errBody}`);
          continue;
        }

        const sellOrder = await sellRes.json();
        orderIds.push(sellOrder.id);
        ordersPlaced++;
        totalLossHarvested += h.loss;

        // 2. Buy replacement if selected
        const replacement: ReplacementItem | undefined = replacements?.[h.symbol];
        if (replacement) {
          // Get live price for replacement
          let replPrice = replacement.price;
          try {
            const finnhubKey = process.env.FINNHUB_IO_API_KEY;
            if (finnhubKey) {
              const fRes = await fetch(
                `https://finnhub.io/api/v1/quote?symbol=${replacement.symbol}&token=${finnhubKey}`,
              );
              if (fRes.ok) {
                const q = await fRes.json();
                if (q.c > 0) replPrice = q.c;
              }
            }
          } catch { /* use estimated price */ }

          const buyQty = Math.max(1, Math.floor(h.loss / replPrice));
          const buyBody = JSON.stringify({
            symbol: replacement.symbol,
            qty: String(buyQty),
            side: 'buy',
            type: 'market',
            time_in_force: 'day',
          });

          const buyRes = await fetch(`${baseUrl}/v2/orders`, {
            method: 'POST',
            headers: {
              'APCA-API-KEY-ID': apiKey,
              'APCA-API-SECRET-KEY': apiSecret,
              'Content-Type': 'application/json',
            },
            body: buyBody,
          });

          if (buyRes.ok) {
            const buyOrder = await buyRes.json();
            orderIds.push(buyOrder.id);
            ordersPlaced++;
          } else {
            const errBody = await buyRes.text();
            errors.push(`${replacement.symbol} buy failed: ${errBody}`);
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
