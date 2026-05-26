// ─── Trade History Sync Endpoint ─────────────────────────────
// Server-side sync: fetches filled orders directly from Alpaca
// and inserts them into the trade_history table with dedup.
// Called by the Trade History page on load — no client-side
// BrokerProvider dependency needed.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALPACA_BASE = process.env.ALPACA_ENVIRONMENT === 'live'
  ? 'https://api.alpaca.markets'
  : 'https://paper-api.alpaca.markets';

async function fetchAlpaca(path: string): Promise<Response> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) throw new Error('Alpaca credentials not configured');
  return fetch(`${ALPACA_BASE}/v2${path}`, {
    headers: {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secretKey,
    },
  });
}

export async function POST(_req: NextRequest): Promise<NextResponse> {
  // Auth check
  try {
    await requireAuth(_req);
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { userId?: string; limit?: number } = {};
  try { body = await _req.json(); } catch { /* keep defaults */ }

  const userId = body.userId;
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  try {
    // Fetch filled orders from Alpaca (most recent first)
    const limit = body.limit || 100;
    const res = await fetchAlpaca(`/orders?status=closed&limit=${limit}&direction=desc`);
    
    if (!res.ok) {
      console.error('[trade-history/sync] Alpaca error:', res.status, await res.text());
      return NextResponse.json({ synced: 0, message: `Alpaca API returned ${res.status}` });
    }

    const orders: Array<{
      id: string; symbol: string; side: string;
      filled_qty: string; filled_avg_price: string | null;
      filled_at: string | null; created_at: string;
      status: string;
    }> = await res.json();

    // Only process filled orders
    const filled = orders.filter(o => o.status === 'filled' && o.filled_avg_price && o.filled_qty);

    if (filled.length === 0) {
      return NextResponse.json({ synced: 0, message: 'No filled orders from Alpaca' });
    }

    const supabase = createServerClient();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const order of filled) {
      const alpacaOrderId = order.id;
      const qty = parseFloat(order.filled_qty);
      const price = parseFloat(order.filled_avg_price!);

      if (!qty || !price || isNaN(qty) || isNaN(price)) {
        skipped++;
        continue;
      }

      try {
        // Check for existing trade by alpaca_order_id
        const { data: existing } = await (supabase as any)
          .from('trade_history')
          .select('id')
          .eq('alpaca_order_id', alpacaOrderId)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Insert new trade
        const { error: insertErr } = await (supabase as any)
          .from('trade_history')
          .insert({
            user_id: userId,
            alpaca_order_id: alpacaOrderId,
            symbol: order.symbol,
            side: order.side,
            action: order.side,
            type: 'market',
            qty,
            quantity: qty,
            filled_price: price,
            price,
            total_value: qty * price,
            status: 'filled',
            executed_at: order.filled_at || order.created_at,
            filled_at: order.filled_at || order.created_at,
          });

        if (insertErr) {
          console.warn('[trade-history/sync] Insert error for', order.symbol, order.id, insertErr);
          errors++;
        } else {
          synced++;
        }
      } catch (err) {
        console.warn('[trade-history/sync] Unexpected error for order', order.id, err);
        errors++;
      }
    }

    return NextResponse.json({
      synced,
      skipped,
      errors,
      total: filled.length,
      message: synced > 0
        ? `Synced ${synced} new trades${skipped > 0 ? ` (${skipped} already existed)` : ''}`
        : skipped > 0
          ? `All ${skipped} trades already synced`
          : 'No new trades to sync',
    });
  } catch (err: any) {
    console.error('[trade-history/sync] Fatal error:', err);
    return NextResponse.json({ synced: 0, error: err?.message || String(err) }, { status: 500 });
  }
}
