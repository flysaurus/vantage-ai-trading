// ─── DCA Strategy Scheduler ─────────────────────────────
// Evaluates all active DCA schedules and executes orders.
// Called by cron endpoint. Places REAL market BUY orders
// through the user's connected brokerage (SnapTrade) via
// SnapTradeBroker — the same engine as execute-trade /
// execute-basket. Falls back to a logged skip only when
// the user has no connected trading brokerage.

interface DcaConfig {
  amount: number;
  frequency: string;
  dayOfWeek?: string;
  dayOfMonth?: string;
  startDate: string;
  endDate?: string;
  investBy?: string;
  quantity?: number;
}

interface DcaSchedule {
  id: string;
  user_id: string;
  symbol: string;
  config: DcaConfig;
  last_run_at: string | null;
  next_run_at: string | null;
  connection_id: string | null;
  is_demo: boolean;
}

interface DcaExecutionResult {
  scheduleId: string;
  symbol: string;
  userId: string;
  action: 'executed' | 'skipped' | 'error';
  details: string;
  amount?: number;
  shares?: number;
  price?: number;
}

import { getPrice } from '@/lib/market-data';
import { isTradingDay } from '@/lib/market-hours';
import { resolveSnapTradeCredentials, SnapTradeAuthError, SnapTradeAmbiguousError } from '@/lib/snaptrade/client';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { formatBrokerName } from '@/lib/broker-name';
import { notifyOrderEvent } from '@/lib/order-emails';
import { notifyOrderNotification } from '@/lib/order-notifications';
import type { OrderRequest, OrderResult } from '@/lib/broker/types';

// ─── Calculate next run time ─────────────────────────────
export function calculateNextRun(config: DcaConfig, fromDate?: Date): Date {
  const now = fromDate || new Date();
  const base = new Date(now);
  base.setHours(14, 30, 0, 0); // execute at 2:30 PM UTC (10:30 AM ET)

  switch (config.frequency) {
    case 'daily':
      // Next trading day: if after cutoff, move to tomorrow
      if (now.getUTCHours() >= 14 || (now.getUTCHours() === 14 && now.getUTCMinutes() >= 30)) {
        base.setDate(base.getDate() + 1);
      }
      break;

    case 'weekly': {
      const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };
      const targetDay = dayMap[config.dayOfWeek || 'mon'] || 1;
      const currentDay = base.getDay(); // 0=Sun
      const mappedCurrent = currentDay === 0 ? 7 : currentDay;
      let daysUntil = targetDay - mappedCurrent;
      if (daysUntil <= 0) daysUntil += 7;
      base.setDate(base.getDate() + daysUntil);
      break;
    }

    case 'biweekly': {
      const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };
      const targetDay = dayMap[config.dayOfWeek || 'mon'] || 1;
      const currentDay = base.getDay();
      const mappedCurrent = currentDay === 0 ? 7 : currentDay;
      let daysUntil = targetDay - mappedCurrent;
      if (daysUntil <= 0) daysUntil += 14; // two weeks forward
      else if (daysUntil < 7) daysUntil += 7; // ensure it's at least a week out
      base.setDate(base.getDate() + daysUntil);
      break;
    }

    case 'monthly': {
      const dayOfMonth = config.dayOfMonth || '1';
      base.setMonth(base.getMonth() + 1);
      base.setDate(1); // start of next month

      if (dayOfMonth === 'last') {
        // Set to last day of month
        base.setMonth(base.getMonth() + 1);
        base.setDate(0); // 0 = last day of previous month
      } else if (dayOfMonth === '15') {
        base.setDate(15);
      } else {
        // '1' or numeric
        const day = parseInt(dayOfMonth) || 1;
        base.setDate(Math.min(day, new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()));
      }
      break;
    }
  }

  // Skip weekends and full-day NYSE holidays — never schedule a DCA run
  // on a day the market is closed.
  let safety = 0;
  while (!isTradingDay(base) && safety < 30) {
    base.setDate(base.getDate() + 1);
    safety++;
  }

  return base;
}

// getPrice() now imported from @/lib/market-data (Finnhub → Alpaca → Yahoo fallback)

// ─── Execute all due DCA schedules ────────────────────────
export async function executeDcaSchedules(supabase: any): Promise<DcaExecutionResult[]> {
  const results: DcaExecutionResult[] = [];
  const now = new Date();

  // Market closed (weekend or full-day holiday) — do not place any DCA orders
  // today. Due schedules stay due and will fire on the next trading day's cron.
  if (!isTradingDay(now)) {
    console.log('[scheduler][dca] Market closed — skipping DCA execution');
    return results;
  }

  // Fetch active DCA schedules that are due. Demo rows (is_demo=true) are
  // NEVER executed — they belong to the demo portfolio and must not fire real
  // orders against a live broker.
  const { data: schedules, error } = await supabase
    .from('strategies')
    .select('id, user_id, symbol, config, last_run_at, next_run_at, connection_id, is_demo')
    .eq('type', 'dca')
    .eq('is_active', true)
    .eq('is_demo', false);

  if (error || !schedules || schedules.length === 0) {
    return results;
  }

  for (const sched of schedules as DcaSchedule[]) {
    try {
      const config = sched.config;
      if (!config?.frequency || !config?.amount) continue;

      // Check if end date has passed
      if (config.endDate) {
        const end = new Date(config.endDate + 'T00:00:00Z');
        if (now > end) {
          // Deactivate expired schedule
          await supabase.from('strategies').update({ is_active: false }).eq('id', sched.id);
          results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'skipped', details: 'Schedule expired (past end date)' });
          continue;
        }
      }

      // Check if start date has arrived
      if (config.startDate) {
        const start = new Date(config.startDate + 'T00:00:00Z');
        if (now < start) {
          results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'skipped', details: 'Not yet started' });
          continue;
        }
      }

      // Check if due based on next_run_at
      if (sched.next_run_at) {
        const nextRun = new Date(sched.next_run_at);
        if (now < nextRun) {
          results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'skipped', details: `Next run: ${nextRun.toISOString()}` });
          continue;
        }
      }

      // Get current price
      const price = await getPrice(sched.symbol);
      if (price == null) {
        results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'error', details: 'Price unavailable' });
        continue;
      }

      // Calculate order details
      let amount = config.amount;
      let shares = 0;
      if (config.investBy === 'shares' && config.quantity) {
        shares = config.quantity;
        amount = shares * price;
      } else {
        shares = amount / price;
      }

      // Place a real order through the user's connected brokerage (SnapTrade).
      // Amount mode → notional_value BUY; shares mode → explicit units.
      // Fails soft (skip) only when no trading broker is connected.
      const isNotional = config.investBy !== 'shares';
      const outcome = await placeDcaOrder(supabase, sched.user_id, sched.symbol, {
        shares,
        amount,
        isNotional,
      }, sched.connection_id);

      // Update schedule
      const nextRun = calculateNextRun(config, now);
      await supabase
        .from('strategies')
        .update({
          last_run_at: now.toISOString(),
          next_run_at: nextRun.toISOString(),
        })
        .eq('id', sched.id);

      results.push({
        scheduleId: sched.id,
        symbol: sched.symbol,
        userId: sched.user_id,
        action: outcome.placed ? 'executed' : outcome.error ? 'error' : 'skipped',
        details: outcome.detail,
        amount,
        shares,
        price,
      });
    } catch (err: any) {
      results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'error', details: err?.message || 'Unknown error' });
    }
  }

  return results;
}

// ─── Place DCA order via the connected broker (SnapTrade) ──
//
// Resolves the user's LIVE SnapTrade credentials and places a real market BUY
// through SnapTradeBroker (the same engine as execute-trade / execute-basket).
// Skips only when the user has no connected trading brokerage. Persists the
// order to `orders` and fires the email + bell notifications so DCA fills are
// visible exactly like manual buys.
async function placeDcaOrder(
  supabase: any,
  userId: string,
  symbol: string,
  opts: { shares: number; amount: number; isNotional: boolean },
  connectionId?: string | null,
): Promise<{ placed: boolean; error: boolean; detail: string }> {
  let creds: Awaited<ReturnType<typeof resolveSnapTradeCredentials>>;
  try {
    // Resolve the EXACT connection the schedule is scoped to (falls back to
    // sole-broker resolution for legacy rows with a NULL connection_id).
    creds = await resolveSnapTradeCredentials(userId, connectionId);
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return { placed: false, error: false, detail: 'No connected brokerage — order not placed' };
    }
    if (err instanceof SnapTradeAmbiguousError) {
      return { placed: false, error: true, detail: 'Multiple brokerages connected — connect exactly one to enable DCA' };
    }
    return { placed: false, error: true, detail: `Credential resolution failed: ${(err as Error)?.message || 'unknown'}` };
  }

  const broker = new SnapTradeBroker({
    userId: creds.snaptradeUserId,
    userSecret: creds.snaptradeUserSecret,
    connectionId: creds.connectionId,
    brokerSlug: creds.brokerSlug,
    brokerName: formatBrokerName(creds.brokerSlug),
    tradingEnabled: creds.tradingEnabled,
  });

  // Internal Vantage order id — sent to the broker as client_order_id for 1:1
  // traceability (idempotency), then reused as orders.id on persist.
  const vantageOrderId = crypto.randomUUID();

  const orderReq: OrderRequest = {
    symbol,
    side: 'BUY',
    type: 'market',
    timeInForce: 'day',
    clientOrderId: vantageOrderId,
  };
  if (opts.isNotional && opts.amount > 0) {
    orderReq.dollarAmount = opts.amount;
  } else {
    orderReq.shares = opts.shares;
  }

  let result: OrderResult;
  try {
    result = await broker.placeOrder(orderReq);
  } catch (err) {
    return { placed: false, error: true, detail: `Order placement failed: ${(err as Error)?.message || 'unknown'}` };
  }

  // Pre-broker sentinels — never reached SnapTrade (validation failures).
  const PHANTOM_ORDER_IDS = new Set(['readonly', 'no-account', 'bad-symbol', 'no-qty', 'unknown']);
  const isPhantom = PHANTOM_ORDER_IDS.has(result.orderId || '');
  const shouldPersist = !isPhantom;

  const orderUnit: 'dollars' | 'shares' = opts.isNotional ? 'dollars' : 'shares';
  const requestedAmount = opts.isNotional
    ? opts.amount
    : (opts.shares > 0 ? Number((opts.shares * (result.fillPrice || 0)).toFixed(2)) : null);
  const requestedQty = opts.isNotional
    ? (result.fillPrice && result.fillPrice > 0 ? Number((opts.amount / result.fillPrice).toFixed(6)) : opts.shares)
    : opts.shares;

  if (shouldPersist) {
    try {
      const now = new Date().toISOString();
      const insertRow: Record<string, unknown> = {
        id: vantageOrderId,
        user_id: userId,
        connection_id: creds.brokerConnectionId,
        symbol: symbol.toUpperCase(),
        qty: opts.shares,
        order_unit: orderUnit,
        requested_amount: requestedAmount,
        requested_qty: requestedQty,
        filled_qty: result.status === 'FILLED' ? (result.filledShares || opts.shares) : 0,
        side: 'buy',
        order_type: 'market',
        status: (result.status || 'OPEN').toLowerCase(),
        filled_price: result.fillPrice || null,
        filled_at: result.filledAt || (result.status === 'FILLED' ? now : null),
        time_in_force: 'day',
        is_demo: false,
        brokerage_order_id: result.orderId || null,
        source: 'dca',
        created_at: now,
      };
      if (opts.isNotional) {
        insertRow.notional = opts.amount;
      }
      await supabase.from('orders').insert(insertRow).select('id').single();
    } catch (persistErr) {
      console.error('[scheduler][dca] ⚠️ DB persist failed:', (persistErr as Error)?.message);
    }
  }

  // Notifications (placed + immediate fill) — mirror execute-trade.
  const brokerName = formatBrokerName(creds.brokerSlug);
  const orderIdForEmail = result.orderId || vantageOrderId;
  const requestedFields = {
    orderUnit,
    requestedAmount: requestedAmount ?? null,
    requestedQty: requestedQty ?? null,
  };

  if (shouldPersist && result.success) {
    const placedShares = result.filledShares || result.estimatedShares || opts.shares || 0;
    const estimatedTotal = result.totalCost
      || (result.fillPrice && placedShares ? result.fillPrice * placedShares : 0)
      || opts.amount
      || 0;

    await notifyOrderEvent(
      supabase,
      userId,
      { kind: 'placed', brokerName, symbol: symbol.toUpperCase(), side: 'BUY', type: 'market', estimatedTotal, orderId: orderIdForEmail, isLive: true, ...requestedFields },
    );
    await notifyOrderNotification(
      supabase,
      userId,
      { kind: 'placed', brokerName, symbol: symbol.toUpperCase(), side: 'BUY', type: 'market', estimatedTotal, orderId: orderIdForEmail, isLive: true, connectionId: creds.brokerConnectionId, ...requestedFields },
    );

    const fillShares = result.filledShares || placedShares || 0;
    const fillPrice = result.fillPrice || 0;
    const totalCost = result.totalCost || (fillPrice * fillShares);

    if (result.status === 'FILLED') {
      await notifyOrderEvent(
        supabase,
        userId,
        { kind: 'filled', brokerName, symbol: symbol.toUpperCase(), side: 'BUY', fillQty: fillShares, fillPrice, fillTotal: totalCost, orderId: orderIdForEmail, isLive: true, ...requestedFields },
      );
      await notifyOrderNotification(
        supabase,
        userId,
        { kind: 'filled', brokerName, symbol: symbol.toUpperCase(), side: 'BUY', fillQty: fillShares, fillPrice, fillTotal: totalCost, orderId: orderIdForEmail, isLive: true, connectionId: creds.brokerConnectionId, ...requestedFields },
      );
    }
  }

  const ok = result.success;
  return {
    placed: ok,
    error: !ok,
    detail: ok
      ? `Buy ${opts.shares.toFixed(4)} ${symbol} = $${opts.amount.toFixed(2)} (${result.status || 'OPEN'})`
      : `Rejected: ${result.message || 'order not accepted'}`,
  };
}
