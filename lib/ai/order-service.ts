// ─── AI-Advisor Order Service (Tranche 2 — real broker orders) ──────────────
// Runs REAL order placement for confirmed pending actions. Called ONLY from the
// deterministic confirm step (lib/ai/executors.ts) after the user explicitly
// confirmed a preview. Mirrors /api/broker/execute-trade and
// /api/broker/execute-basket, but runs directly with the service-role client +
// userId (no cookie forwarding).
//
// Safety layers preserved (same as the endpoints):
//   - verifyTradeSymbol() — Finnhub symbol re-verification (hallucination gate).
//   - checkIdempotency()  — server-side duplicate-order guard.
//   - resolveSnapTradeCredentials() — throws on missing/ambiguous broker.
//   - SnapTradeBroker.placeOrder/placeBasketOrder — the real engine.
//   - persist to `orders` + notifications (email + bell).
//
// The pending-action row itself is the outer idempotency guard: it transitions
// pending→executed atomically, so these functions run at most once per confirm.
// ─────────────────────────────────────────────────────────────────────────────

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
import { notifyBasketEvent, type BasketOrderEvent } from '@/lib/order-emails';
import { notifyBasketNotification } from '@/lib/order-notifications';
import { formatBrokerName } from '@/lib/broker-name';
import { resolveCompanyName, resolveCompanyNames } from '@/lib/market-data';
import { availableCash } from '@/lib/available-cash';

export interface ExecResult {
  ok: boolean;
  message: string;
}

const PHANTOM_ORDER_IDS = new Set(['readonly', 'no-account', 'bad-symbol', 'no-qty', 'unknown']);

// ── Single trade (BUY / SELL) ────────────────────────────────────────────────

export interface PlaceSingleTradeArgs {
  supabase: any;
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  shares?: number | null;
  dollarAmount?: number | null;
  orderType?: 'market' | 'limit' | 'stop' | 'stop_limit';
  limitPrice?: number | null;
  stopPrice?: number | null;
  timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
  currentPrice?: number | null;
  /** broker_connections.id to scope the trade to a specific live account (multi-broker). */
  connectionId?: string | null;
  /**
   * Skip the Finnhub symbol-validity gate (Gate 1). Set true ONLY for
   * deterministic broker-sourced legs (e.g. rebalance sells of real held
   * positions), where the symbol came from the broker itself rather than an
   * LLM — so an obscure ETF the user actually holds (CPER, etc.) isn't
   * blocked just because Finnhub doesn't list it.
   */
  skipSymbolGate?: boolean;
}

export async function placeSingleTrade(args: PlaceSingleTradeArgs): Promise<ExecResult> {
  const { supabase, userId } = args;
  const symbol = (args.symbol || '').trim().toUpperCase();
  const side = args.side;
  const shares = args.shares ?? null;
  const dollarAmount = args.dollarAmount ?? null;
  const orderType = args.orderType || 'market';
  const limitPrice = args.limitPrice ?? undefined;
  const stopPrice = args.stopPrice ?? undefined;
  const timeInForce = args.timeInForce || 'day';
  const currentPrice = args.currentPrice ?? undefined;
  const skipSymbolGate = args.skipSymbolGate === true;
  const requestedConnectionId = args.connectionId ?? null;

  if (!symbol) return { ok: false, message: 'Missing symbol.' };
  if (!['BUY', 'SELL'].includes(side)) return { ok: false, message: 'Invalid side.' };
  if (shares == null && dollarAmount == null) {
    return { ok: false, message: 'Provide shares or a dollar amount.' };
  }

  // Gate 1: symbol re-verification (Finnhub). messageId=null → cross-check
  // skipped, but Gate 1 (is this a real ticker?) still applies.
  if (!skipSymbolGate) {
    try {
      const gate = await verifyTradeSymbol(symbol, null, supabase, null);
      if (!gate.allowed) {
        console.error(`[order-service] 🚫 BLOCKED by trade-gate: ${symbol} — ${gate.detail || gate.reason}`);
        return { ok: false, message: gate.reason };
      }
    } catch (e) {
      return { ok: false, message: 'Safety verification failed — order not placed.' };
    }
  }

  // Gate 2: idempotency (manual path = time-window; the pending-action row is
  // the outer once-per-confirm guard).
  const idem = await checkIdempotency(supabase, userId, null, symbol, side);
  if (!idem.allowed) {
    return { ok: false, message: idem.reason || 'This order was already submitted.' };
  }

  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let connectionId: string;
  let brokerConnectionId: string;
  let brokerSlug: string;
  let tradingEnabled: boolean;

  try {
    const creds = await resolveSnapTradeCredentials(userId, requestedConnectionId);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    connectionId = creds.connectionId;
    brokerConnectionId = creds.brokerConnectionId;
    brokerSlug = creds.brokerSlug;
    tradingEnabled = creds.tradingEnabled;
  } catch (err) {
    const msg = err instanceof SnapTradeAuthError || err instanceof SnapTradeAmbiguousError
      ? err.message
      : 'Failed to load brokerage credentials.';
    await releaseIdempotency(supabase, idem.dedupKey).catch(() => {});
    return { ok: false, message: msg };
  }

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

    const vantageOrderId = crypto.randomUUID();
    const result = await broker.placeOrder({
      symbol,
      side,
      type: orderType,
      shares: shares ?? undefined,
      dollarAmount: dollarAmount ?? undefined,
      limitPrice,
      stopPrice,
      timeInForce,
      currentPrice,
      clientOrderId: vantageOrderId,
    });
    orderPlaced = true;

    if (!result.success) {
      await releaseIdempotency(supabase, idem.dedupKey).catch(() => {});
      return { ok: false, message: result.message || 'Order rejected by broker.' };
    }

    const brokerName = formatBrokerName(brokerSlug);
    const now = new Date().toISOString();
    const isNotional = dollarAmount != null && dollarAmount > 0;
    const effectiveQty = shares || 0;
    const orderUnit: 'dollars' | 'shares' = isNotional ? 'dollars' : 'shares';
    const referencePrice = limitPrice || currentPrice || result.fillPrice || 0;
    const requestedAmount = isNotional
      ? dollarAmount
      : (referencePrice > 0 && effectiveQty > 0 ? Number((effectiveQty * referencePrice).toFixed(2)) : null);
    const requestedQty = isNotional
      ? (effectiveQty > 0 ? effectiveQty : (referencePrice > 0 ? Number((dollarAmount! / referencePrice).toFixed(6)) : null))
      : effectiveQty;

    const isPhantom = PHANTOM_ORDER_IDS.has(result.orderId || '');
    const shouldPersist = !isPhantom;

    let dbOrderId: string | null = null;
    if (shouldPersist) {
      const insertRow: Record<string, unknown> = {
        id: vantageOrderId,
        user_id: userId,
        connection_id: brokerConnectionId,
        symbol,
        qty: effectiveQty,
        order_unit: orderUnit,
        requested_amount: requestedAmount,
        requested_qty: requestedQty,
        filled_qty: result.status === 'FILLED' ? (result.filledShares || effectiveQty) : 0,
        side: side.toLowerCase(),
        order_type: orderType.toLowerCase(),
        status: (result.status || 'OPEN').toLowerCase(),
        filled_price: result.fillPrice || null,
        filled_at: result.filledAt || (result.status === 'FILLED' ? now : null),
        time_in_force: timeInForce.toLowerCase(),
        is_demo: false,
        brokerage_order_id: result.orderId || null,
        source: 'ai_advisor',
        created_at: now,
      };
      if (isNotional) insertRow.notional = dollarAmount;
      const { data, error: dbErr } = await supabase
        .from('orders')
        .insert(insertRow)
        .select('id')
        .single();
      dbOrderId = data?.id || null;
      if (dbErr) {
        console.error('[order-service] ⚠️ persist failed:', dbErr.message);
      } else {
        // Best-effort company-name attach (never break the critical insert).
        try {
          const cname = await resolveCompanyName(symbol);
          if (cname) {
            await supabase.from('orders').update({ company_name: cname }).eq('id', dbOrderId);
          }
        } catch { /* non-fatal */ }
      }
    }

    const orderIdForEmail = result.orderId || dbOrderId || '';
    const requestedFields = {
      orderUnit,
      requestedAmount: requestedAmount ?? null,
      requestedQty: requestedQty ?? null,
    };
    const placedShares = result.filledShares || result.estimatedShares || shares || 0;
    const estimatedTotal = result.totalCost
      || (result.fillPrice && placedShares ? result.fillPrice * placedShares : 0)
      || dollarAmount
      || 0;

    await notifyOrderEvent(supabase, userId, {
      kind: 'placed',
      brokerName,
      symbol,
      side,
      type: orderType,
      limitPrice,
      stopPrice,
      estimatedTotal,
      orderId: orderIdForEmail,
      isLive: true,
      ...requestedFields,
    });
    await notifyOrderNotification(supabase, userId, {
      kind: 'placed',
      brokerName,
      symbol,
      side,
      type: orderType,
      limitPrice,
      stopPrice,
      estimatedTotal,
      orderId: orderIdForEmail,
      isLive: true,
      ...requestedFields,
    });

    if (result.status === 'FILLED') {
      const fillShares = result.filledShares || placedShares || 0;
      const fillPrice = result.fillPrice || 0;
      const totalCost = result.totalCost || (fillPrice * fillShares);
      await notifyOrderEvent(supabase, userId, {
        kind: 'filled',
        brokerName,
        symbol,
        side,
        fillQty: fillShares,
        fillPrice,
        fillTotal: totalCost,
        orderId: orderIdForEmail,
        isLive: true,
        ...requestedFields,
      });
      await notifyOrderNotification(supabase, userId, {
        kind: 'filled',
        brokerName,
        symbol,
        side,
        fillQty: fillShares,
        fillPrice,
        fillTotal: totalCost,
        orderId: orderIdForEmail,
        isLive: true,
        ...requestedFields,
      });
    }

    const label = side === 'BUY' ? 'Bought' : 'Sold';
    return {
      ok: true,
      message: `✅ ${label} ${symbol} (${result.status.toLowerCase()}) — ${
        result.filledShares ? `${result.filledShares} shares` : (result.message || 'order submitted')
      }.`,
    };
  } catch (err) {
    if (!orderPlaced) {
      await releaseIdempotency(supabase, idem.dedupKey).catch(() => {});
    }
    console.error('[order-service] placeSingleTrade threw:', err);
    return { ok: false, message: (err as Error).message || 'Trade execution failed.' };
  }
}

// ── Basket execute ───────────────────────────────────────────────────────────

export interface PlaceBasketArgs {
  supabase: any;
  userId: string;
  basketName?: string;
  basketEmoji?: string;
  stocks: Array<{ symbol: string; dollarAmount: number; allocationPct?: number; fallbackPrice?: number }>;
  totalBudget?: number;
  /** broker_connections.id to scope the basket to a specific live account (multi-broker). */
  connectionId?: string | null;
}

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

export async function placeBasketTrade(args: PlaceBasketArgs): Promise<ExecResult> {
  const { supabase, userId } = args;
  const stocks = args.stocks || [];
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return { ok: false, message: 'Basket needs at least one stock.' };
  }
  for (const s of stocks) {
    if (!s?.symbol || s.dollarAmount == null || Number.isNaN(Number(s.dollarAmount))) {
      return { ok: false, message: 'Each basket leg needs a symbol and dollar amount.' };
    }
  }

  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let connectionId: string;
  let brokerConnectionId: string;
  let brokerSlug: string;
  let tradingEnabled: boolean;

  try {
    const creds = await resolveSnapTradeCredentials(userId, args.connectionId ?? null);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    connectionId = creds.connectionId;
    brokerConnectionId = creds.brokerConnectionId;
    brokerSlug = creds.brokerSlug;
    tradingEnabled = creds.tradingEnabled;
  } catch (err) {
    const msg = err instanceof SnapTradeAuthError || err instanceof SnapTradeAmbiguousError
      ? err.message
      : 'Failed to load brokerage credentials.';
    return { ok: false, message: msg };
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

    const totalBudget = args.totalBudget
      ?? stocks.reduce((sum, s) => sum + (Number(s.dollarAmount) || 0), 0);

    // Server-side funds guard (mirrors execute-basket).
    const requestedTotal = stocks.reduce((sum, s) => sum + (Number(s.dollarAmount) || 0), 0);
    if (requestedTotal > 0) {
      try {
        const acct = await broker.getAccount();
        const available = availableCash({ cash: acct.cashBalance, buyingPower: acct.buyingPower }, 0);
        if (requestedTotal > available) {
          return {
            ok: false,
            message: `Insufficient funds. Order total $${requestedTotal.toFixed(2)} exceeds available cash $${available.toFixed(2)}.`,
          };
        }
      } catch { /* balance fetch failure is non-fatal — broker will reject on true shortfall */ }
    }

    const userBasketId = crypto.randomUUID();
    const themeBase = (args.basketName || 'Basket').trim() || 'Basket';
    const basketEmoji = args.basketEmoji || '';
    const dateSuffix = formatBasketDateET(new Date());
    const basketDisplay = `${themeBase} - ${dateSuffix}`;

    const normalizedStocks = stocks.map((s) => ({
      symbol: s.symbol.toUpperCase(),
      dollarAmount: Number(s.dollarAmount) || 0,
      allocationPct: totalBudget > 0 ? (Number(s.dollarAmount) / totalBudget) * 100 : 0,
      fallbackPrice: s.fallbackPrice,
    }));

    const result = await broker.placeBasketOrder({
      basketId: userBasketId,
      basketName: themeBase,
      basketEmoji,
      basketDisplayName: basketDisplay,
      stocks: normalizedStocks,
      totalBudget,
    });

    if (!result.success) {
      return { ok: false, message: result.message || 'Basket order rejected.' };
    }

    const brokerName = formatBrokerName(brokerSlug);
    const now = new Date().toISOString();

    await supabase.from('user_baskets').upsert({
      id: userBasketId,
      user_id: userId,
      name: basketDisplay,
      theme_label: themeBase,
      icon: args.basketEmoji || null,
      status: 'active',
      connection_id: brokerConnectionId || null,
    }, { onConflict: 'id' });

    const legs = result.orders || [];
    const legSymbols = legs.map((l) => (l.symbol || '').toUpperCase()).filter(Boolean);
    const namesBySymbol = await resolveCompanyNames(legSymbols);

    await Promise.all(
      legs.map(async (leg) => {
        const symbol = (leg.symbol || '').toUpperCase();
        if (!symbol) return;
        const legId = leg.clientOrderId || crypto.randomUUID();
        const dollarAmount = leg.reservedAmount ?? 0;
        const isFilled = leg.status === 'FILLED';
        const insertRow: Record<string, unknown> = {
          id: legId,
          user_id: userId,
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
          source: 'ai_advisor',
          notional: dollarAmount,
          created_at: now,
        };
        const { data, error: dbErr } = await supabase
          .from('orders')
          .insert(insertRow)
          .select('id')
          .single();
        if (dbErr) {
          console.error(`[order-service] ⚠️ basket leg persist failed for ${symbol}:`, dbErr.message);
          return;
        }
        const insertedId = data?.id || legId;
        const cname = namesBySymbol[symbol];
        if (cname) {
          try {
            await supabase.from('orders').update({ company_name: cname }).eq('id', insertedId);
          } catch { /* non-fatal */ }
        }
      }),
    );

    const filledLegs = legs.filter((l) => l.status === 'FILLED');
    const eventKind: BasketOrderEvent['event'] =
      legs.length > 0 && filledLegs.length === legs.length
        ? 'filled'
        : filledLegs.length > 0
          ? 'partially_filled'
          : 'placed';

    const basketEvent: BasketOrderEvent = {
      brokerName,
      basketName: basketDisplay,
      basketEmoji: args.basketEmoji,
      event: eventKind,
      positions: legs.map((leg) => ({
        symbol: (leg.symbol || '').toUpperCase(),
        side: 'BUY',
        orderUnit: 'dollars',
        requestedAmount: leg.reservedAmount ?? 0,
        requestedQty: null,
        type: 'market',
        fillPrice: leg.fillPrice ?? null,
        fillQty: leg.filledShares ?? 0,
        fillTotal: (leg.fillPrice ?? 0) * (leg.filledShares ?? 0),
      })),
      isLive: true,
      orderIds: legs.map((leg) => leg.orderId).filter((id): id is string => !!id),
    };
    await Promise.allSettled([
      notifyBasketEvent(supabase, userId, basketEvent),
      notifyBasketNotification(supabase, userId, basketEvent),
    ]);

    return {
      ok: true,
      message: `✅ Basket "${basketDisplay}" executed — ${result.executed ?? legs.length} of ${legs.length} legs placed.`,
    };
  } catch (err) {
    console.error('[order-service] placeBasketTrade threw:', err);
    return { ok: false, message: (err as Error).message || 'Basket execution failed.' };
  }
}
