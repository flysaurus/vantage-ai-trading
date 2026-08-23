// ─── POST /api/broker/execute-basket ────────────────────────
// Server-side proxy for basket orders on a REAL SnapTrade connection.
//
// The client-side `executeBasketTrade` used to call `placeBasketOrder()`
// directly on the object returned by `useBroker()` — but that object is a
// `BrokerAdapter` (SnapTradeAdapter), which is READ-ONLY and has no such
// method (crash: `l.placeBasketOrder is not a function`).
//
// This route mirrors `/api/broker/execute-trade`: it resolves SnapTrade
// credentials server-side, constructs a `SnapTradeBroker` (the NEW engine
// that actually implements `placeBasketOrder`), places the N legs, persists
// each leg to `orders`, and returns the aggregated `BasketOrderResult`.
//
// NOTE: baskets carry NO chat messageId, so the AI trade-gate (which guards
// against symbol hallucination on AI-inferred trades) does not apply here —
// basket legs are explicit user selections. Server-side basket idempotency is
// a follow-up (the client already guards double-tap via submittingBasketRef).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { createClient } from '@supabase/supabase-js';

function formatBrokerName(slug: string | null): string {
  if (!slug) return 'Unknown';
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: {
    basketId?: string;
    basketName?: string;
    basketEmoji?: string;
    basketDisplayName?: string;
    stocks?: Array<{ symbol: string; dollarAmount: number; allocationPct: number; fallbackPrice?: number }>;
    totalBudget?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { basketId = '', basketName = '', basketEmoji = '', basketDisplayName = '', stocks = [], totalBudget = 0 } = body;

  if (!Array.isArray(stocks) || stocks.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Missing required field: stocks (non-empty array)' },
      { status: 400 },
    );
  }
  for (const s of stocks) {
    if (!s?.symbol || s.dollarAmount == null || Number.isNaN(Number(s.dollarAmount))) {
      return NextResponse.json(
        { success: false, error: 'Each stock requires a symbol and numeric dollarAmount' },
        { status: 400 },
      );
    }
  }

  // ── Supabase client (service role — credential lookup + persist) ──
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Resolve credentials + connection metadata ──
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let connectionId: string;
  let brokerConnectionId: string;
  let brokerSlug: string;
  let tradingEnabled: boolean = false;

  try {
    const creds = await resolveSnapTradeCredentials(authUser!.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    connectionId = creds.connectionId;
    brokerConnectionId = creds.brokerConnectionId;
    brokerSlug = creds.brokerSlug;
    tradingEnabled = creds.tradingEnabled;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, status: 'REJECTED' },
        { status: err.status },
      );
    }
    if (err instanceof SnapTradeAmbiguousError) {
      return NextResponse.json(
        { success: false, error: err.message, status: 'REJECTED' },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to load brokerage credentials.', status: 'REJECTED' },
      { status: 502 },
    );
  }

  try {
    const broker = new SnapTradeBroker({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
      connectionId,
      brokerSlug,
      brokerName: formatBrokerName(brokerSlug),
      tradingEnabled,
    });

    const result = await broker.placeBasketOrder({
      basketId,
      basketName,
      basketEmoji,
      basketDisplayName,
      stocks,
      totalBudget,
    });

    // ── Persist each successful leg to `orders` ──
    // Basket legs are always notional (dollarAmount) market BUY orders. Each
    // leg carries its own clientOrderId UUID → orders.id, and is linked to a
    // user_baskets row via orders.basket_id so Order History can group the
    // whole basket into a single card.
    const brokerName = formatBrokerName(brokerSlug);
    const now = new Date().toISOString();
    const persisted: string[] = [];

    // The client-side `basketId` is a curated catalog id or `custom_<ts>` —
    // NOT a valid UUID — so we mint a fresh user_baskets.id here and link
    // every leg to it. Order History joins orders.basket_id → user_baskets.
    const userBasketId = crypto.randomUUID();
    const basketDisplay = basketDisplayName || basketName || 'Basket';
    const { error: basketErr } = await supabase
      .from('user_baskets')
      .insert({
        id: userBasketId,
        user_id: authUser!.id,
        name: basketDisplay,
        theme_label: basketName || null,
        icon: basketEmoji || null,
        status: 'active',
        connection_id: brokerConnectionId || null,
      });
    if (basketErr) {
      console.error('[execute-basket] ⚠️ user_baskets insert failed:', JSON.stringify(basketErr, null, 2));
    } else {
      console.log(`[execute-basket] 🧺 Basket group persisted: ${userBasketId} ("${basketDisplay}")`);
    }

    for (const leg of result.orders) {
      const symbol = (leg.symbol || '').toUpperCase();
      if (!symbol) continue;
      const legId = leg.clientOrderId || crypto.randomUUID();
      const dollarAmount = leg.reservedAmount ?? 0;
      const isFilled = leg.status === 'FILLED';
      const insertRow: Record<string, unknown> = {
        id: legId,
        user_id: authUser!.id,
        connection_id: brokerConnectionId,
        basket_id: userBasketId,
        symbol,
        qty: 0,
        order_unit: 'dollars',
        requested_amount: dollarAmount,
        requested_qty: null,
        filled_qty: isFilled ? (leg.filledShares || 0) : 0,
        side: 'buy',
        order_type: 'market',
        status: (leg.status || 'OPEN').toLowerCase(),
        filled_price: leg.fillPrice || null,
        filled_at: leg.filledAt || (isFilled ? now : null),
        time_in_force: 'day',
        is_demo: false,
        brokerage_order_id: leg.orderId || null,
        source: 'manual',
        notional: dollarAmount,
        created_at: now,
      };
      try {
        const { data, error: dbErr } = await supabase
          .from('orders')
          .insert(insertRow)
          .select('id')
          .single();
        if (dbErr) {
          console.error(`[execute-basket] ⚠️ DB persist failed for ${symbol}:`, JSON.stringify(dbErr, null, 2));
        } else {
          persisted.push(data?.id || legId);
          console.log(`[execute-basket] 💾 Leg persisted: ${symbol} → ${data?.id} (broker ${leg.orderId})`);
        }
      } catch (persistErr) {
        console.error(`[execute-basket] ⚠️ DB persist exception for ${symbol}:`, persistErr);
      }
    }

    return NextResponse.json({
      success: result.success,
      basketOrderId: result.basketOrderId,
      status: result.status,
      orders: result.orders,
      totalReserved: result.totalReserved,
      totalSpent: result.totalSpent,
      executed: result.executed,
      failed: result.failed,
      message: result.message,
      brokerName,
      basketId: userBasketId,
      persisted,
    });
  } catch (err) {
    const msg = (err as Error).message || 'Basket execution failed';
    console.error('[execute-basket] Error:', msg);
    return NextResponse.json(
      { success: false, error: msg, status: 'REJECTED' },
      { status: 502 },
    );
  }
}
