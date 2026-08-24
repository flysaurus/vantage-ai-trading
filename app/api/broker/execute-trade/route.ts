// ─── POST /api/broker/execute-trade ──────────────────────────
// Server-side proxy: resolves SnapTrade credentials, creates a
// SnapTradeBroker, and calls placeOrder(). This keeps SnapTrade
// credentials server-side while allowing the client to execute
// real trades through the NEW broker engine (not the old stub).
//
// ═══════════════════════════════════════════════════════════════
// HARD BOUNDARY CHECK (2026-08-08):
// Before ANY order fires, verifyTradeSymbol() re-verifies the
// symbol against Finnhub and confirms the company name matches
// what was shown to the user in the chat. If mismatch → BLOCKED.
// This is defense-in-depth. The primary defense is the merged
// symbol-resolution system; this gate is the permanent last line.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
  SnapTradeAmbiguousError,
} from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { verifyTradeSymbol } from '@/lib/ai/trade-gate';
import { checkIdempotency, releaseIdempotency } from '@/lib/broker/order-idempotency';
import { notifyOrderEvent } from '@/lib/order-emails';
import { notifyOrderNotification } from '@/lib/order-notifications';
import { formatBrokerName } from '@/lib/broker-name';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: {
    symbol: string;
    side: 'BUY' | 'SELL';
    shares: number;
    orderType?: 'market' | 'limit' | 'stop' | 'stop_limit';
    /** Optional dollar amount (AI trades default to $500) */
    dollarAmount?: number;
    limitPrice?: number;
    stopPrice?: number;
    timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
    /** Current market price — enables after-hours market→limit conversion */
    currentPrice?: number;
    /** Chat message ID — enables trade-gate company-name verification */
    messageId?: string | null;
    /** Company name displayed in chat — passed directly for max reliability */
    expectedCompanyName?: string | null;
    /** broker_connections.id — explicit account selection (multi-broker safety) */
    connectionId?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const { symbol, side, shares, orderType, dollarAmount, limitPrice, stopPrice, timeInForce, currentPrice, messageId, expectedCompanyName, connectionId: requestedConnectionId } = body;

  if (!symbol || !side || (shares == null && dollarAmount == null)) {
    return NextResponse.json(
      { success: false, error: 'Missing required fields: symbol, side, and shares or dollarAmount' },
      { status: 400 },
    );
  }

  // ── Supabase client (used for credential lookup + trade gate) ──
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ═══════════════════════════════════════════════════════════════
  // GATE 1: Trade-gate — re-verify symbol before money moves
  // ═══════════════════════════════════════════════════════════════
  const gateResult = await verifyTradeSymbol(symbol, messageId, supabase, expectedCompanyName);

  if (!gateResult.allowed) {
    console.error(
      `[execute-trade] 🚫 BLOCKED by trade-gate: ${symbol} for user ${authUser!.id}\n` +
      `  Detail: ${gateResult.detail || gateResult.reason}`,
    );
    return NextResponse.json(
      {
        success: false,
        error: gateResult.reason,
        status: 'BLOCKED',
        blockedBy: 'trade-gate',
      },
      { status: 422 },
    );
  }

  console.log(`[execute-trade] trade-gate passed: ${gateResult.reason}`);

  // ═══════════════════════════════════════════════════════════════
  // GATE 2: Idempotency guard — reject duplicate submissions
  // ═══════════════════════════════════════════════════════════════
  const idempotency = await checkIdempotency(supabase, authUser!.id, messageId, symbol, side);

  if (!idempotency.allowed) {
    console.error(
      `[execute-trade] 🚫 BLOCKED by idempotency guard: ${symbol} ${side} for user ${authUser!.id}`,
    );
    return NextResponse.json(
      {
        success: false,
        error: idempotency.reason || 'This order was already submitted.',
        status: 'DUPLICATE',
        blockedBy: 'idempotency',
      },
      { status: 409 },
    );
  }

  // --- Resolve credentials + connection metadata ---
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let connectionId: string;
  let brokerConnectionId: string;
  let brokerSlug: string;
  let tradingEnabled: boolean = false;

  try {
    const creds = await resolveSnapTradeCredentials(authUser!.id, requestedConnectionId);
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

  // --- Place the order ---
  let orderPlaced = false;
  try {
    const broker = new SnapTradeBroker({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
      connectionId,
      brokerSlug,
      brokerName: formatBrokerName(brokerSlug),
      tradingEnabled,
    });

    // Internal Vantage order id — generated up-front so the same UUID can be
    // sent to the broker as `client_order_id` (defense-in-depth idempotency +
    // 1:1 traceability back to Vantage's own orders.id). It must be created
    // before placeOrder because client_order_id rides in the SnapTrade request
    // body, while the DB row (and its id) is only inserted afterward.
    const vantageOrderId = crypto.randomUUID();

    const result = await broker.placeOrder({
      symbol,
      side,
      type: orderType || 'market',
      shares,
      dollarAmount,
      limitPrice,
      stopPrice,
      timeInForce: timeInForce || 'day',
      currentPrice,
      clientOrderId: vantageOrderId,
    });

    orderPlaced = true;

    // Broker rejected the order — release the reservation so the user can retry.
    if (!result.success) {
      await releaseIdempotency(supabase, idempotency.dedupKey).catch(() => {});
    }

    // ── Persist order to database (Phase 6: real broker order lifecycle) ──
    //
    // Decision tree for orderId:
    //   Real UUID / 'error'  → reached broker  → INSERT with brokerage_order_id (or null for 'error')
    //   Pre-broker sentinels  → never reached SnapTrade → SKIP (phantom)
    //
    // Pre-broker sentinels are orderIds returned by placeOrder() for validation
    // failures that happen before any HTTP call to SnapTrade.
    const PHANTOM_ORDER_IDS = new Set(['readonly', 'no-account', 'bad-symbol', 'no-qty', 'unknown']);
    const isPhantom = PHANTOM_ORDER_IDS.has(result.orderId || '');
    const shouldPersist = !isPhantom; // persist real broker orders (including rejected ones)
    let dbOrderId: string | null = null;
    let dbWarnMsg: string | null = null;

    // ── Four-field requested model (hoisted so persist + email share it) ──
    //   order_unit       = 'dollars' when the user specified a dollar amount, else 'shares'
    //   requested_amount = authoritative when dollars, else derived estimate
    //   requested_qty    = authoritative when shares, else derived estimate
    const isNotionalOrder = dollarAmount != null && dollarAmount > 0;
    const effectiveQty = shares || 0;
    const orderUnit: 'dollars' | 'shares' = isNotionalOrder ? 'dollars' : 'shares';
    const referencePrice = limitPrice || currentPrice || result.fillPrice || 0;
    const requestedAmount = isNotionalOrder
      ? dollarAmount
      : (referencePrice > 0 && effectiveQty > 0 ? Number((effectiveQty * referencePrice).toFixed(2)) : null);
    const requestedQty = isNotionalOrder
      ? (effectiveQty > 0 ? effectiveQty : (referencePrice > 0 ? Number((dollarAmount / referencePrice).toFixed(6)) : null))
      : effectiveQty;

    if (shouldPersist) {
      try {
        const now = new Date().toISOString();
        // notional=null if column doesn't exist yet (migration 042 pending).
        // qty always stores the share estimate so it's meaningful even without notional.
        const insertRow: Record<string, unknown> = {
          id: vantageOrderId,
          user_id: authUser!.id,
          connection_id: brokerConnectionId,
          symbol: symbol.toUpperCase(),
          qty: effectiveQty,
          order_unit: orderUnit,
          requested_amount: requestedAmount,
          requested_qty: requestedQty,
          filled_qty: result.status === 'FILLED' ? (result.filledShares || effectiveQty) : 0,
          side: side.toLowerCase(),
          order_type: (orderType || 'market').toLowerCase(),
          status: (result.status || 'OPEN').toLowerCase(),
          filled_price: result.fillPrice || null,
          filled_at: result.filledAt || (result.status === 'FILLED' ? now : null),
          time_in_force: (timeInForce || 'day').toLowerCase(),
          is_demo: false,
          brokerage_order_id: result.orderId || null,
          source: messageId ? 'ai_advisor' : 'manual',
          created_at: now,
        };
        if (isNotionalOrder) {
          insertRow.notional = dollarAmount;
        }
        const { data: dbOrder, error: dbErr } = await supabase
          .from('orders')
          .insert(insertRow)
          .select('id')
          .single();
        dbOrderId = dbOrder?.id || null;
        if (dbErr) {
          console.error('[execute-trade] ⚠️ DB order persist failed:', JSON.stringify(dbErr, null, 2));
          dbWarnMsg = `Order at ${formatBrokerName(brokerSlug)} but could not be saved locally — it may not appear in history until the next sync.`;
        } else {
          console.log(`[execute-trade] 💾 Order persisted to DB: ${dbOrder?.id} (${result.orderId})`);
        }
      } catch (persistErr) {
        console.error('[execute-trade] ⚠️ DB persist exception:', persistErr);
        dbWarnMsg = `Order at ${formatBrokerName(brokerSlug)} but local persist failed — check broker directly if it doesn't appear.`;
      }
    } else {
      console.warn(
        `[execute-trade] ⚠️ SKIPPED DB persist — phantom order (orderId: "${result.orderId}"). ` +
        `Pre-broker validation failure: ${result.message || 'unknown'}`
      );
    }

    // ── Order email: placed / filled / partial / rejected ──
    //
    // "Placed" fires whenever the order reached the broker (not a phantom,
    // not rejected). "Filled"/"Partially Filled" fire here ONLY for immediate
    // execution (market orders during hours) — the sync cron handles deferred
    // fills via the in-flight transition, so this branch can't double-email.
    // "Rejected" fires when the order reached the broker but was not accepted.
    const brokerName = formatBrokerName(brokerSlug);
    const orderIdForEmail = result.orderId || dbOrderId || '';
    const requestedFields = {
      orderUnit,
      requestedAmount: requestedAmount ?? null,
      requestedQty: requestedQty ?? null,
    };

    if (shouldPersist && result.success) {
      const placedShares = result.filledShares || result.estimatedShares || shares || 0;
      const estimatedTotal = result.totalCost
        || (result.fillPrice && placedShares ? result.fillPrice * placedShares : 0)
        || dollarAmount
        || 0;

      await notifyOrderEvent(
        supabase,
        authUser!.id,
        {
          kind: 'placed',
          brokerName,
          symbol: symbol.toUpperCase(),
          side,
          type: orderType || 'market',
          limitPrice,
          stopPrice,
          estimatedTotal,
          orderId: orderIdForEmail,
          isLive: true,
          ...requestedFields,
        },
        authUser!.email,
      );

      await notifyOrderNotification(
        supabase,
        authUser!.id,
        {
          kind: 'placed',
          brokerName,
          symbol: symbol.toUpperCase(),
          side,
          type: orderType || 'market',
          limitPrice,
          stopPrice,
          estimatedTotal,
          orderId: orderIdForEmail,
          isLive: true,
          ...requestedFields,
        },
      );

      const fillShares = result.filledShares || placedShares || 0;
      const fillPrice = result.fillPrice || 0;
      const totalCost = result.totalCost || (fillPrice * fillShares);

      if (result.status === 'FILLED') {
        await notifyOrderEvent(
          supabase,
          authUser!.id,
          {
            kind: 'filled',
            brokerName,
            symbol: symbol.toUpperCase(),
            side,
            fillQty: fillShares,
            fillPrice,
            fillTotal: totalCost,
            orderId: orderIdForEmail,
            isLive: true,
            ...requestedFields,
          },
          authUser!.email,
        );

        await notifyOrderNotification(
          supabase,
          authUser!.id,
          {
            kind: 'filled',
            brokerName,
            symbol: symbol.toUpperCase(),
            side,
            fillQty: fillShares,
            fillPrice,
            fillTotal: totalCost,
            orderId: orderIdForEmail,
            isLive: true,
            ...requestedFields,
          },
        );
      } else if (result.status === 'PARTIALLY_FILLED') {
        const remainingQty = Math.max(0, Number(requestedQty ?? effectiveQty ?? 0) - Number(fillShares));
        await notifyOrderEvent(
          supabase,
          authUser!.id,
          {
            kind: 'partially_filled',
            brokerName,
            symbol: symbol.toUpperCase(),
            side,
            fillQty: fillShares,
            fillPrice,
            fillTotal: totalCost,
            remainingQty,
            orderId: orderIdForEmail,
            isLive: true,
            ...requestedFields,
          },
          authUser!.email,
        );

        await notifyOrderNotification(
          supabase,
          authUser!.id,
          {
            kind: 'partially_filled',
            brokerName,
            symbol: symbol.toUpperCase(),
            side,
            fillQty: fillShares,
            fillPrice,
            fillTotal: totalCost,
            remainingQty,
            orderId: orderIdForEmail,
            isLive: true,
            ...requestedFields,
          },
        );
      }
    } else if (shouldPersist && !result.success) {
      await notifyOrderEvent(
        supabase,
        authUser!.id,
        {
          kind: 'rejected',
          brokerName,
          symbol: symbol.toUpperCase(),
          side,
          reason: result.message,
          orderId: orderIdForEmail,
          isLive: true,
          ...requestedFields,
        },
        authUser!.email,
      );

      await notifyOrderNotification(
        supabase,
        authUser!.id,
        {
          kind: 'rejected',
          brokerName,
          symbol: symbol.toUpperCase(),
          side,
          reason: result.message,
          orderId: orderIdForEmail,
          isLive: true,
          ...requestedFields,
        },
      );
    }

    return NextResponse.json({
      success: result.success,
      status: result.status,
      orderId: result.orderId,
      message: result.message,
      fillPrice: result.fillPrice,
      totalCost: result.totalCost,
      filledShares: result.filledShares,
      filledAt: result.filledAt,
      dbOrderId,
      dbWarnMsg,
    });
  } catch (err) {
    // If placeOrder threw before the order reached the broker, release the
    // reservation so the user can retry. (If persist/email threw AFTER a
    // successful placement, keep the key — the order did happen.)
    if (!orderPlaced) {
      await releaseIdempotency(supabase, idempotency.dedupKey).catch(() => {});
    }
    const msg = (err as Error).message || 'Trade execution failed';
    console.error('[execute-trade] Error:', msg);
    return NextResponse.json(
      { success: false, error: msg, status: 'REJECTED' },
      { status: 502 },
    );
  }
}
