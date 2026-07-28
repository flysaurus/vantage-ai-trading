// ─── Fill Engine ──────────────────────────────────────────────
// Pure functions for order fill checking, stop triggering, and
// DAY order expiry. Used by BOTH DemoBroker (client-side) and
// the /api/cron/execute-pending-orders cron (server-side).
//
// No side effects, no I/O — just decision logic. Callers are
// responsible for fetching quotes, mutating state, and persisting.

import type { BrokerOrder, BrokerPosition } from './engine';
import { getMarketStatus } from '@/lib/market-hours';

export interface FillDecision {
  action: 'fill' | 'trigger_stop' | 'skip' | 'expire';
  /** Fill price (set when action is 'fill') */
  fillPrice?: number;
  /** For stop_limit: the limit price to use after trigger */
  effectiveLimitPrice?: number;
  /** Reason for non-fill (for logging) */
  reason?: string;
}

/**
 * Decide what should happen to a single OPEN order given a fresh quote.
 * Returns the appropriate action and fill price if applicable.
 *
 * Called by both:
 *   - DemoBroker.executePendingOrders() (client)
 *   - /api/cron/execute-pending-orders (server, via processPortfolioState)
 */
export function evaluateOpenOrder(
  order: BrokerOrder,
  quotePrice: number,
  now: Date,
  marketIsOpen: boolean,
): FillDecision {
  // ── Expiry check (runs first — a DAY order at/after close should expire even if fillable) ──
  // isDayOrderExpiredAt() handles all type/status guards internally:
  //   - stop/stop_limit → always GTC, never expire
  //   - timeInForce='gtc' → never expire
  //   - market must be closed and order from prior calendar day (ET)
  if (isDayOrderExpiredAt(order, now, marketIsOpen)) {
    return { action: 'expire', reason: 'DAY order expired at market close' };
  }

  // ── STOP / STOP-LIMIT: check trigger ──
  const stopPrice = order.stopPrice;
  if (stopPrice && stopPrice > 0 && (order.type === 'stop' || order.type === 'stop_limit')) {
    const triggered = order.side === 'BUY'
      ? quotePrice >= stopPrice   // stop-buy triggers when price rises to stop
      : quotePrice <= stopPrice;  // stop-sell triggers when price falls to stop

    if (!triggered) {
      return { action: 'skip', reason: `Stop not triggered (stop=$${stopPrice.toFixed(2)}, quote=$${quotePrice.toFixed(2)})` };
    }

    // Stop triggered! For plain stop → market fill. For stop-limit → limit fill.
    if (order.type === 'stop_limit') {
      const limitPx = order.limitPrice || order.submittedPrice;
      return evaluateLimitFill(order, quotePrice, marketIsOpen, limitPx);
    }
    // Plain stop: triggered → market fill
    if (!marketIsOpen) {
      return { action: 'skip', reason: 'Stop triggered but market closed' };
    }
    return { action: 'fill', fillPrice: quotePrice };
  }

  // ── MARKET orders: fill if market open ──
  if (order.type === 'market') {
    if (!marketIsOpen) {
      return { action: 'skip', reason: 'Market closed' };
    }
    return { action: 'fill', fillPrice: quotePrice };
  }

  // ── LIMIT orders: fill if price meets limit ──
  const limitPrice = order.limitPrice || order.submittedPrice;
  return evaluateLimitFill(order, quotePrice, marketIsOpen, limitPrice);
}

/**
 * Check if a limit order should fill at the given price.
 */
function evaluateLimitFill(
  order: BrokerOrder,
  quotePrice: number,
  marketIsOpen: boolean,
  limitPrice: number,
): FillDecision {
  if (!marketIsOpen) {
    return { action: 'skip', reason: 'Market closed' };
  }

  const limitMet = order.side === 'BUY'
    ? quotePrice <= limitPrice   // limit BUY: fill if price <= limit
    : quotePrice >= limitPrice;  // limit SELL: fill if price >= limit

  if (!limitMet) {
    return {
      action: 'skip',
      reason: `Limit not met (limit=$${limitPrice.toFixed(2)}, quote=$${quotePrice.toFixed(2)})`,
    };
  }

  return { action: 'fill', fillPrice: quotePrice };
}

/**
 * Determine if a DAY order should be considered expired.
 *
 * A DAY order expires when:
 * - The market session has already ended for the day (after close), AND
 * - The order was submitted on a previous calendar day (not today)
 *
 * KEY: We do NOT expire orders during pre-market on the next trading day.
 * Orders submitted on a weekend should survive until at least Monday's close.
 *
 * This double-check prevents premature expiry:
 * - "submitted today, market closed now" → NOT expired (might have filled today)
 * - "submitted Saturday/Sunday, Monday pre-market" → NOT expired (market hasn't opened yet)
 * - "submitted yesterday, after market close today" → expired (today's session is over)
 *
 * Stop and stop-limit orders are NOT subject to day expiry — they always
 * behave as GTC.
 */
export function isDayOrderExpiredAt(
  order: BrokerOrder,
  now: Date,
  marketIsOpen: boolean,
): boolean {
  // Stop orders are inherently GTC — never auto-expire
  if (order.type === 'stop' || order.type === 'stop_limit') return false;

  // GTC orders never auto-expire
  if (order.timeInForce === 'gtc') return false;

  // Only check expiry when market is closed
  if (marketIsOpen) return false;

  // Only expire if today's market session has ACTUALLY ENDED (after close).
  // If it's pre-market, the market hasn't opened yet today — the order
  // should survive and get a chance to fill when the market opens.
  if (!isAfterMarketClose()) return false;

  // Check if this order was submitted on a previous calendar day
  // Use ET for consistency with market hours
  const orderDate = new Date(order.submittedAt);
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const etOrderDate = new Date(orderDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  // Compare calendar days in ET
  const todayET = etNow.toISOString().split('T')[0];
  const orderDayET = etOrderDate.toISOString().split('T')[0];

  return orderDayET !== todayET;
}

/**
 * Determine if the current time is within regular market hours.
 * Delegates to the shared market-hours module.
 */
export function isMarketOpenNow(): boolean {
  return getMarketStatus().isOpen;
}

/**
 * Check if the current time is after market close (for expiry determination).
 * Returns true if the market is closed AND we're past the regular close time
 * (i.e., not pre-market).
 */
export function isAfterMarketClose(): boolean {
  const status = getMarketStatus();
  return !status.isOpen && status.period !== 'premarket';
}
