// ─── Server-Side Order Processor ─────────────────────────────
// Operates on raw demo_portfolio_state rows from Supabase.
// Used exclusively by the /api/cron/execute-pending-orders cron.
//
// Does NOT instantiate DemoBroker — works directly on JSON state
// so it can run server-side with no localStorage or browser APIs.

import type { BrokerOrder, BrokerPosition, DemoStateInternal } from './engine';
import { evaluateOpenOrder, isDayOrderExpiredAt, isMarketOpenNow, isAfterMarketClose, getETDateString } from './fill-engine';
import type { FillDecision } from './fill-engine';
import { sendOrderNotification, sendBasketNotification } from '@/lib/notifications';
import { getBatchQuotes } from '@/lib/market-data';

export interface StaleOrderNotification {
  userId: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  shares: number;
  limitPrice?: number;
  currentPrice: number;
  submittedAt: string;
  stalenessHours: number;
}

// ─── Quote batching (multi-source: Finnhub → Alpaca → Yahoo) ──

async function fetchQuotesBatch(symbols: string[]): Promise<Map<string, number>> {
  const quotes = new Map<string, number>();
  try {
    const results = await getBatchQuotes(symbols);
    for (const [sym, quote] of results) {
      if (quote.price > 0) quotes.set(sym, quote.price);
    }
  } catch (err: any) {
    console.error('[fetchQuotesBatch] Error:', err?.message || err);
  }
  return quotes;
}

// ─── Processing result types ─────────────────────────────────

export interface OrderProcessSummary {
  userId: string;
  filled: number;
  expired: number;
  skipped: number;
  errors: number;
  cashReleased: number;
}

export interface BatchProcessResult {
  processedCount: number;
  totalFilled: number;
  totalExpired: number;
  totalSkipped: number;
  totalErrors: number;
  totalCashReleased: number;
  perUser: OrderProcessSummary[];
}

// ─── Main processor ──────────────────────────────────────────

interface PortfolioRow {
  user_id: string;
  positions: BrokerPosition[];
  cash_balance: number;
  orders: BrokerOrder[];
  basket_orders: any[];
}

/**
 * Process all pending orders in a single user's portfolio state.
 * Mutates the row in place. Returns a summary.
 */
// ─── Staleness threshold (48h for demo GTC orders) ──────────
const GTC_STALE_HOURS = 48;
const GTC_RENOTIFY_HOURS = 24; // cooldown before re-notifying

export function processUserOrders(
  row: PortfolioRow,
  quotes: Map<string, number>,
  now: Date,
  userEmail?: string,
  supabase?: any,
): { result: OrderProcessSummary; updated: boolean; staleNotifications: StaleOrderNotification[] } {
  const marketOpen = isMarketOpenNow();
  const afterClose = isAfterMarketClose();

  let filled = 0;
  let expired = 0;
  let skipped = 0;
  let errors = 0;
  let cashReleased = 0;
  let forceSave = false;

  const openOrders = row.orders.filter(o => o.status === 'OPEN');
  if (openOrders.length === 0) {
    return {
      result: { userId: row.user_id, filled: 0, expired: 0, skipped: 0, errors: 0, cashReleased: 0 },
      updated: false,
      staleNotifications: [],
    };
  }

  for (const order of openOrders) {
    try {
      const quotePrice = quotes.get(order.symbol.toUpperCase());
      if (quotePrice == null || quotePrice <= 0) {
        skipped++;
        continue;
      }

      const decision = evaluateOpenOrder(order, quotePrice, now, marketOpen);

      switch (decision.action) {
        case 'fill': {
          const fillPx = decision.fillPrice || quotePrice;
          applyFill(row, order, fillPx, userEmail);
          filled++;
          // ── Notify: cron fill ──
          if (userEmail) {
            sendOrderNotification(userEmail, {
              type: 'order_filled',
              orderId: order.id,
              symbol: order.symbol,
              side: order.side,
              orderType: order.type,
              shares: order.shares,
              fillPrice: fillPx,
              submittedPrice: order.submittedPrice,
            }).catch(() => {});
          }
          break;
        }
        case 'expire': {
          applyExpiry(row, order);
          cashReleased += order.reservedCost || 0;
          expired++;
          // ── Notify: cron expiry ──
          if (userEmail) {
            sendOrderNotification(userEmail, {
              type: 'order_cancelled',
              orderId: order.id,
              symbol: order.symbol,
              side: order.side,
              orderType: order.type,
              shares: order.shares,
              cancelReason: 'day_expired',
              submittedPrice: order.submittedPrice,
            }).catch(() => {});
          }
          break;
        }
        case 'skip': {
          // ── Market order diagnostic: if the market is OPEN and a market order
          //     was skipped, it's because no quote was available. Log loudly.
          if (order.type === 'market' && marketOpen) {
            console.error(
              `[processUserOrders] ⚠️ MARKET ORDER SKIPPED during market hours! ` +
              `order=${order.id} symbol=${order.symbol} side=${order.side} ` +
              `shares=${order.shares} — quote unavailable. Order will NOT fill until a quote is available.`
            );
          }

          // Check for DAY expiry separately (evaluateOpenOrder handles this for
          // non-stop orders, but we double-check here for edge cases)
          if (order.type !== 'stop' && order.type !== 'stop_limit' && afterClose && !marketOpen) {
            const orderDate = new Date(order.submittedAt);
            if (getETDateString(now) !== getETDateString(orderDate)) {
              applyExpiry(row, order);
              cashReleased += order.reservedCost || 0;
              expired++;
              if (userEmail) {
                sendOrderNotification(userEmail, {
                  type: 'order_cancelled',
                  orderId: order.id,
                  symbol: order.symbol,
                  side: order.side,
                  orderType: order.type,
                  shares: order.shares,
                  cancelReason: 'day_expired',
                  submittedPrice: order.submittedPrice,
                }).catch(() => {});
              }
              break;
            }
          }
          skipped++;
          break;
        }
      }
    } catch (err: any) {
      console.error(`[processUserOrders] Error processing order ${order.id}:`, err.message);
      errors++;
    }
  }

  // ── Notify: basket transitions (cron) ──
  if (userEmail && filled > 0) {
    const basketOrders = row.basket_orders || [];
    for (const bo of basketOrders) {
      if (bo.status === 'FILLED' && bo._justFilled !== false) {
        const boOrders = row.orders.filter((o: BrokerOrder) => o.basketOrderId === bo.id);
        if (boOrders.length > 0) {
          const filledOrders = boOrders.filter((o: BrokerOrder) => o.status === 'FILLED');
          const failedOrders = boOrders.filter((o: BrokerOrder) => o.status === 'CANCELLED');
          const totalInvested = filledOrders.reduce((sum: number, o: BrokerOrder) => sum + (o.totalCost || 0), 0);
          sendBasketNotification(userEmail, {
            type: failedOrders.length > 0 ? 'basket_partial_fill' : 'basket_filled',
            basketId: bo.basketId || bo.id,
            basketName: bo.basketName || '',
            basketEmoji: bo.basketEmoji || '',
            positions: boOrders.map((o: BrokerOrder) => ({
              symbol: o.symbol,
              shares: o.shares,
              fillPrice: o.fillPrice || o.submittedPrice || 0,
              totalCost: o.totalCost || 0,
              status: (o.status === 'FILLED' ? 'filled' : 'failed') as 'filled' | 'failed',
            })),
            totalInvested,
            filledCount: filledOrders.length,
            failedCount: failedOrders.length,
          }).catch(() => {});
        }
      }
    }
  }

  // ── Staleness check: GTC orders unfilled > 48h ──
  const staleNotifications: StaleOrderNotification[] = [];
  const nowMs = now.getTime();
  const staleThresholdMs = GTC_STALE_HOURS * 60 * 60 * 1000;
  const renotifyThresholdMs = GTC_RENOTIFY_HOURS * 60 * 60 * 1000;

  for (const order of openOrders) {
    // Only check GTC orders
    if (order.timeInForce !== 'gtc') continue;

    const submittedMs = new Date(order.submittedAt).getTime();
    const ageHours = (nowMs - submittedMs) / (60 * 60 * 1000);

    if (ageHours < GTC_STALE_HOURS) continue;

    // Cooldown: don't re-notify if already notified recently
    const lastNotifiedMs = (order as any)._stalenessNotifiedAt
      ? new Date((order as any)._stalenessNotifiedAt).getTime()
      : 0;
    if (nowMs - lastNotifiedMs < renotifyThresholdMs) continue;

    // Get current price for comparison
    const currentPrice = quotes.get(order.symbol.toUpperCase());
    const priceDelta = currentPrice != null && order.limitPrice != null
      ? ((currentPrice - order.limitPrice) / order.limitPrice * 100).toFixed(1)
      : null;

    staleNotifications.push({
      userId: row.user_id,
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      shares: order.shares,
      limitPrice: order.limitPrice,
      currentPrice: currentPrice || 0,
      submittedAt: order.submittedAt,
      stalenessHours: Math.round(ageHours),
    });

    // Mark as notified
    (order as any)._stalenessNotifiedAt = now.toISOString();
    forceSave = true; // force save to persist _stalenessNotifiedAt

    // ── Email notification ──
    if (userEmail) {
      const details = currentPrice != null
        ? `Current: $${currentPrice.toFixed(2)}${order.limitPrice != null ? ` (${Number(priceDelta) >= 0 ? '+' : ''}${priceDelta}% vs limit $${order.limitPrice.toFixed(2)})` : ''}. Visit Vantage to adjust or cancel.`
        : 'Quote unavailable. Visit Vantage to review.';
      sendOrderNotification(userEmail, {
        type: 'order_cancelled' as const,
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        shares: order.shares,
        cancelReason: 'day_expired' as const,
        details,
        submittedPrice: order.submittedPrice,
        limitPrice: order.limitPrice,
      }).catch(() => {});
    }
  }

  return {
    result: { userId: row.user_id, filled, expired, skipped, errors, cashReleased },
    updated: filled > 0 || expired > 0 || forceSave,
    staleNotifications,
  };
}

// ─── Fill application ────────────────────────────────────────

function applyFill(row: PortfolioRow, order: BrokerOrder, fillPrice: number, userEmail?: string): void {
  order.status = 'FILLED';
  order.fillPrice = fillPrice;
  order.filledAt = new Date().toISOString();
  order.note = undefined;

  if (order.side === 'BUY') {
    const cost = order.reservedCost || order.totalCost;
    const shares = cost / fillPrice;
    order.shares = shares;
    order.totalCost = cost;

    // Deduct actual fill cost from cash_balance.
    // Client-side DemoBroker handles this via pre-reservation at order creation,
    // but server-side cron operates directly on Supabase rows where cash may
    // not have been pre-reserved (especially for orders synced pre-fix).
    // When the row WAS pre-reserved (saveState writes to Supabase post-fix),
    // the reservedCost is already reflected in cash_balance. The cron only
    // processes OPEN orders — which by definition haven't been filled yet —
    // so the pre-reservation deduction in cash_balance IS the correct state.
    // We reconcile the difference between reservedCost and actual cost here.
    if (order.totalCost !== order.reservedCost) {
      const diff = order.reservedCost ? (order.reservedCost - order.totalCost) : 0;
      row.cash_balance += diff; // adjust for price difference
    }

    // Upsert position
    upsertPosition(row.positions, {
      symbol: order.symbol,
      shares,
      price: fillPrice,
      cost,
      basketId: order.basketId,
      basketName: order.basketName,
      basketEmoji: order.basketEmoji,
    });
  } else {
    // SELL
    const shares = order.shares;
    const proceeds = shares * fillPrice;
    order.totalCost = proceeds;
    order.fillPrice = fillPrice;

    // Remove shares from position
    removePosition(row.positions, order.symbol, shares);
    row.cash_balance += proceeds;
  }

  // Mark basket as FILLED if this completes it
  if (order.basketOrderId) {
    const basketOrder = row.basket_orders?.find((b: any) => b.id === order.basketOrderId);
    if (basketOrder && basketOrder.status === 'OPEN') {
      const basketOrders = row.orders.filter((o: BrokerOrder) => o.basketOrderId === order.basketOrderId);
      const allFilled = basketOrders.every((o: BrokerOrder) => o.status !== 'OPEN');
      if (allFilled) {
        basketOrder.status = 'FILLED';
        basketOrder.filledAt = new Date().toISOString();
      }
    }
  }
}

function applyExpiry(row: PortfolioRow, order: BrokerOrder): void {
  order.status = 'CANCELLED';
  order.cancelledAt = new Date().toISOString();
  order.note = 'DAY order expired at market close';

  // Release reserved cash for BUY orders
  if (order.side === 'BUY' && order.reservedCost) {
    row.cash_balance += order.reservedCost;
  }
}

// ─── Position helpers (mirror DemoBroker's logic) ────────────

function upsertPosition(
  positions: BrokerPosition[],
  params: {
    symbol: string; shares: number; price: number; cost: number;
    basketId?: string; basketName?: string; basketEmoji?: string;
  },
): void {
  const idx = positions.findIndex(
    p => p.symbol === params.symbol && p.basketId === (params.basketId || undefined)
  );
  if (idx >= 0) {
    const p = positions[idx];
    const newShares = p.shares + params.shares;
    const newCost = p.totalCost + params.cost;
    p.shares = newShares;
    p.totalCost = newCost;
    p.avgCost = newCost / newShares;
  } else {
    positions.push({
      symbol: params.symbol,
      name: params.symbol,
      sector: '',
      type: 'Stock',
      shares: params.shares,
      avgCost: params.price,
      totalCost: params.cost,
      buyDate: new Date().toISOString(),
      basketId: params.basketId,
      basketName: params.basketName,
      basketEmoji: params.basketEmoji,
    });
  }
}

function removePosition(positions: BrokerPosition[], symbol: string, shares: number): void {
  const idx = positions.findIndex(p => p.symbol === symbol);
  if (idx === -1) return;
  const pos = positions[idx];
  if (shares >= pos.shares) {
    positions.splice(idx, 1);
  } else {
    pos.shares -= shares;
    pos.totalCost = pos.shares * pos.avgCost;
  }
}

// ─── Top-level batch processor ───────────────────────────────

/**
 * Fetch all portfolio states with OPEN orders, fetch quotes, process fills.
 * This is the main entry point for the cron endpoint.
 */
export async function processAllPendingOrders(
  supabase: any,
): Promise<BatchProcessResult> {
  const now = new Date();

  // 1. Fetch all portfolio states. Single canonical column: order_history (BrokerOrder[]).
  const { data: rows, error } = await supabase
    .from('demo_portfolio_state')
    .select('user_id, positions, cash_balance, order_history, basket_orders');

  if (error) {
    console.error('[processAllPendingOrders] Supabase query error:', error.message);
    return {
      processedCount: 0, totalFilled: 0, totalExpired: 0,
      totalSkipped: 0, totalErrors: 0, totalCashReleased: 0,
      perUser: [],
    };
  }

  // Normalize: createdAt→submittedAt for legacy DemoOrder-format records.
  // This is NOT dual-read — it is single-column format normalization.
  const normalized = (rows || []).map((r: any) => ({
    ...r,
    orders: (r.order_history || []).map((o: any) => ({
      ...o,
      submittedAt: o.submittedAt || o.createdAt || o.submitted_at,
    })),
  }));

  // 2. Filter to only rows with OPEN orders
  const active: PortfolioRow[] = normalized.filter(
    (r: any) => (r.orders || []).some((o: any) => o.status === 'OPEN')
  );

  if (active.length === 0) {
    console.log('[processAllPendingOrders] No users with OPEN orders');
    return {
      processedCount: 0, totalFilled: 0, totalExpired: 0,
      totalSkipped: 0, totalErrors: 0, totalCashReleased: 0,
      perUser: [],
    };
  }

  // 3. Collect all unique symbols from OPEN orders
  const symbols = new Set<string>();
  for (const row of active) {
    for (const order of (row.orders || [])) {
      if (order.status === 'OPEN') {
        symbols.add(order.symbol);
      }
    }
  }

  console.log(`[processAllPendingOrders] Processing ${active.length} users, ${symbols.size} unique symbols`);

  // 4. Look up user emails for notifications
  const userEmails = new Map<string, string>();
  try {
    const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
    if (authErr) throw authErr;
    for (const u of (authUsers?.users || [])) {
      if (u.email) userEmails.set(u.id, u.email);
    }
  } catch (err: any) {
    console.log('[processAllPendingOrders] Could not fetch user emails (notifications disabled):', err.message);
  }

  // 5. Batch-fetch quotes
  const quotes = await fetchQuotesBatch([...symbols]);
  console.log(`[processAllPendingOrders] Fetched ${quotes.size}/${symbols.size} quotes`);

  // 6. Process each user
  const perUser: OrderProcessSummary[] = [];
  let totalFilled = 0, totalExpired = 0, totalSkipped = 0, totalErrors = 0, totalCashReleased = 0;
  const allStaleNotifications: StaleOrderNotification[] = [];

  for (const row of active) {
    try {
      const userEmail = userEmails.get(row.user_id);
      const { result, updated, staleNotifications } = processUserOrders(row, quotes, now, userEmail, supabase);

      if (updated) {
        // Persist changes — canonical column: order_history
        const { error: updateErr } = await supabase
          .from('demo_portfolio_state')
          .upsert({
            user_id: row.user_id,
            positions: row.positions,
            cash_balance: row.cash_balance,
            order_history: row.orders,
            basket_orders: row.basket_orders,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });

        if (updateErr) {
          console.error(`[processAllPendingOrders] Failed to save user ${row.user_id}:`, updateErr.message);
          result.errors++;
        }
      }

      perUser.push(result);
      totalFilled += result.filled;
      totalExpired += result.expired;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
      totalCashReleased += result.cashReleased;

      // Collect stale notifications for in-app notification
      if (staleNotifications.length > 0) {
        allStaleNotifications.push(...staleNotifications);
      }
    } catch (err: any) {
      console.error(`[processAllPendingOrders] Error processing user ${row.user_id}:`, err.message);
      perUser.push({ userId: row.user_id, filled: 0, expired: 0, skipped: 0, errors: 1, cashReleased: 0 });
      totalErrors++;
    }
  }

  // 7. Write stale notifications to recent_notifications (in-app feed)
  if (allStaleNotifications.length > 0) {
    await writeStaleNotifications(supabase, allStaleNotifications);
  }

  const staleCount = allStaleNotifications.length;
  console.log(
    `[processAllPendingOrders] Done — ${totalFilled} filled, ${totalExpired} expired, ` +
    `${staleCount} stale notified, $${totalCashReleased.toFixed(2)} cash released, ${totalErrors} errors`
  );

  return {
    processedCount: active.length,
    totalFilled, totalExpired, totalSkipped, totalErrors, totalCashReleased,
    perUser,
  };
}

// ─── Stale notification writer ───────────────────────────────

async function writeStaleNotifications(
  supabase: any,
  notifications: StaleOrderNotification[],
): Promise<void> {
  for (const n of notifications) {
    try {
      const priceInfo = n.currentPrice > 0
        ? `$${n.currentPrice.toFixed(2)}${n.limitPrice ? ` vs limit $${n.limitPrice.toFixed(2)}` : ''}`
        : 'quote unavailable';

      const message = `⏳ GTC ${n.side} ${n.symbol} unfilled for ${n.stalenessHours}h — current ${priceInfo}. Tap to adjust or cancel. [order:${n.orderId}|${n.symbol}|${n.side}|${n.shares}|${n.limitPrice || ''}|${n.currentPrice}]`;

      const { error } = await supabase
        .from('recent_notifications')
        .insert({
          user_id: n.userId,
          type: 'order_stale',
          title: `⏳ GTC ${n.side} ${n.symbol} — Order Stale`,
          message,
          action_url: '/?tab=invest',
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error(`[writeStaleNotifications] Failed for ${n.orderId}:`, error.message);
      }
    } catch (err: any) {
      console.error(`[writeStaleNotifications] Error for ${n.orderId}:`, err.message);
    }
  }

  console.log(`[writeStaleNotifications] Wrote ${notifications.length} stale notifications`);
}
