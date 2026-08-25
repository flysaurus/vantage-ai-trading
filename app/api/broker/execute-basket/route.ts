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
import { notifyBasketEvent, type BasketOrderEvent } from '@/lib/order-emails';
import { notifyBasketNotification } from '@/lib/order-notifications';
import { formatBrokerName } from '@/lib/broker-name';
import { resolveCompanyNames } from '@/lib/market-data';

// System basket name date suffix: MMDDYYYY in America/New_York (matches the
// user's ET trading day, not UTC — a basket placed 19:00 ET is still "today").
function formatBasketDateET(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('month')}${g('day')}${g('year')}`;
}

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: {
    basketId?: string;
    basketName?: string;
    basketEmoji?: string;
    basketDisplayName?: string;
    existingBasketId?: string;
    stocks?: Array<{ symbol: string; dollarAmount: number; allocationPct: number; fallbackPrice?: number }>;
    totalBudget?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { basketId = '', basketName = '', basketEmoji = '', basketDisplayName = '', existingBasketId = '', stocks = [], totalBudget = 0 } = body;

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
    // NOT a valid UUID — so for a NEW basket we mint a fresh user_baskets.id
    // here and link every leg to it. Order History joins orders.basket_id →
    // user_baskets.
    //
    // EDIT-in-place: when the client passes `existingBasketId` (a real
    // user_baskets.id), we REUSE that row — same id, same name — instead of
    // minting a duplicate with a re-appended date. This is what makes
    // "edit pending basket" update the existing order rather than spawn
    // "GLP-1 Ripple Effect - 08232026 - 08242026".
    const themeBase = (basketName || basketDisplayName || 'Basket').trim() || 'Basket';
    const dateSuffix = formatBasketDateET(new Date());
    let userBasketId: string;
    let basketDisplay: string;
    let userBasketThemeLabel: string | null = themeBase || null;
    let isUpdate = false;

    if (existingBasketId) {
      const { data: existing, error: lookupErr } = await supabase
        .from('user_baskets')
        .select('id, name, theme_label')
        .eq('id', existingBasketId)
        .eq('user_id', authUser!.id)
        .maybeSingle();

      if (!lookupErr && existing) {
        // Reuse the row + name VERBATIM (no date re-append). Preserve the
        // clean theme_label so future counter lookups still key off the theme.
        userBasketId = existing.id;
        basketDisplay = existing.name || `${themeBase} - ${dateSuffix}`;
        userBasketThemeLabel = existing.theme_label ?? themeBase ?? null;
        isUpdate = true;
      } else {
        // Stale/unknown id → fall back to mint-new.
        userBasketId = crypto.randomUUID();
        basketDisplay = `${themeBase} - ${dateSuffix}`;
      }
    } else {
      // System-generated name: "[Theme] - MMDDYYYY" + per-theme-per-day counter
      // (2), (3)… — never user-editable.
      userBasketId = crypto.randomUUID();
      let counter = 1;
      try {
        const { data: prior } = await supabase
          .from('user_baskets')
          .select('id, theme_label, created_at')
          .eq('user_id', authUser!.id)
          .eq('theme_label', themeBase);
        const sameDay = (prior || []).filter((b: any) => {
          try { return formatBasketDateET(new Date(b.created_at)) === dateSuffix; } catch { return false; }
        });
        counter = sameDay.length + 1;
      } catch (e) {
        console.error('[execute-basket] ⚠️ counter query failed (non-fatal):', e);
      }
      basketDisplay =
        counter === 1 ? `${themeBase} - ${dateSuffix}` : `${themeBase} - ${dateSuffix} (${counter})`;
    }

    const { error: basketErr } = await supabase
      .from('user_baskets')
      .upsert({
        id: userBasketId,
        user_id: authUser!.id,
        name: basketDisplay,
        theme_label: userBasketThemeLabel,
        icon: basketEmoji || null,
        status: 'active',
        connection_id: brokerConnectionId || null,
      }, { onConflict: 'id' });
    if (basketErr) {
      console.error(`[execute-basket] ⚠️ user_baskets ${isUpdate ? 'upsert' : 'insert'} failed:`, JSON.stringify(basketErr, null, 2));
    } else {
      console.log(`[execute-basket] 🧺 Basket ${isUpdate ? 'updated' : 'persisted'}: ${userBasketId} ("${basketDisplay}")`);
    }

    // Resolve + persist full company/ETF names for every leg up front (parallel,
    // one Finnhub→Yahoo pass) so each persisted order carries its own name and
    // the client never needs a live lookup again.
    const legSymbols = result.orders.map((l) => (l.symbol || '').toUpperCase()).filter(Boolean);
    const namesBySymbol = await resolveCompanyNames(legSymbols);

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
        company_name: namesBySymbol[symbol] || null,
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

    // ── Notifications: basket summary + individual legs (email + bell) ──
    // Email: ONE consolidated email (basket header + per-position table).
    // Bell: 1 basket row + N per-leg rows (individual stock orders, same
    // style as single-order "placed" notifications).
    const basketEvent: BasketOrderEvent = {
      brokerName,
      basketName: basketDisplay,
      basketEmoji: basketEmoji || undefined,
      event: 'placed',
      positions: result.orders.map((leg) => ({
        symbol: (leg.symbol || '').toUpperCase(),
        side: 'BUY',
        orderUnit: 'dollars',
        requestedAmount: leg.reservedAmount ?? 0,
        requestedQty: null,
        type: 'market',
      })),
      isLive: true,
      orderIds: result.orders
        .map((leg) => leg.orderId)
        .filter((id): id is string => !!id),
    };
    await Promise.allSettled([
      notifyBasketEvent(supabase, authUser!.id, basketEvent),
      notifyBasketNotification(supabase, authUser!.id, basketEvent),
    ]);

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
      basketName: basketDisplay,
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
