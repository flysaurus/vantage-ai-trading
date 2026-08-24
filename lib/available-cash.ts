// lib/available-cash.ts
//
// SINGLE SOURCE OF TRUTH for "available cash" (spendable) across the app:
//   - Portfolio tab CASH tile
//   - TradeTicket "Available cash"
//   - AI Advisor budget checks
//
// FINAL (2026-08-16): cash − open reservations as PRIMARY; buying_power
// secondary/informational only.
//
// "Available cash" must mean actual settled cash, not margin buying power.
// Buying power ($391K on a margin/paper account) ≠ spendable cash ($93K).
// Never backfill from another account's state (see cross-account isolation).

export interface CashBalanceFields {
  /** Total settled cash balance. */
  cash?: number | null;
  /** Broker-reported spendable buying power (net of open orders/holds). */
  buyingPower?: number | null;
}

export interface OpenOrderReservation {
  status?: string | null;
  requestedAmount?: number | null;
  requestedQty?: number | null;
  orderUnit?: 'dollars' | 'shares' | null;
  notional?: number | null;
  qty?: number | null;
  fillPrice?: number | null;
  limitPrice?: number | null;
  /** Already-filled quantity (for partially_filled orders). */
  filledQty?: number | null;
  /** Price at which the filled portion executed. */
  filledPrice?: number | null;
  /** Explicit already-filled dollar cost (overrides filledQty × filledPrice). */
  filledCost?: number | null;
}

const OPEN_STATUSES = new Set(['open', 'submitted', 'partially_filled']);

/**
 * Sum of dollar value reserved by still-open orders = SUM(requested_amount
 * WHERE status IN open/submitted/partially_filled), per the four-field model.
 * Falls back to notional, then requestedQty/qty × a reference price when
 * requested_amount is null.
 */
export function sumOpenReservedAmount(orders: OpenOrderReservation[]): number {
  let total = 0;
  for (const o of orders) {
    if (!o || !o.status || !OPEN_STATUSES.has(o.status.toLowerCase())) continue;

    // Base reservation: requested_amount (authoritative), then notional, then
    // requestedQty/qty × a reference price.
    let reserved = 0;
    if (o.requestedAmount != null && Number(o.requestedAmount) > 0) {
      reserved = Number(o.requestedAmount);
    } else if (o.notional != null && Number(o.notional) > 0) {
      reserved = Number(o.notional);
    } else {
      const refPrice = Number(o.fillPrice ?? o.limitPrice ?? 0);
      const qty = Number(o.requestedQty ?? o.qty ?? 0);
      if (refPrice > 0 && qty > 0) reserved = qty * refPrice;
    }

    // Money-correctness: a partially_filled order has already SPENT the filled
    // portion. Release it from the reservation so only the unfilled remainder
    // stays "locked". Without this, partially_filled orders (which stay in
    // OPEN_STATUSES) would keep their FULL original reservation forever, and
    // the filled cash would be double-counted against available cash.
    if (o.status.toLowerCase() === 'partially_filled') {
      const filledQty = Number(o.filledQty ?? 0);
      const filledPrice = Number(o.filledPrice ?? 0);
      const filledCost = Number(o.filledCost ?? 0) || (filledQty * filledPrice);
      reserved = Math.max(0, reserved - filledCost);
    }

    total += reserved;
  }
  return total;
}

/**
 * Available cash (spendable). FINAL: cash − open reservations primary;
 * buying_power secondary/informational only.
 *
 * @param balance            cash + buyingPower (from broker.getAccount()); null-safe
 * @param openReservedAmount SUM(requested_amount WHERE open) — subtracted from
 *                           cash (or buying_power fallback).
 */
export function availableCash(
  balance: CashBalanceFields | null | undefined,
  openReservedAmount = 0,
): number {
  const reserved = Number(openReservedAmount) || 0;
  // PRIMARY: actual settled cash − open reservations.
  const cash = balance?.cash;
  if (cash != null && Number.isFinite(Number(cash))) {
    return Math.max(0, Number(cash) - reserved);
  }
  // SECONDARY/informational: buying power only when cash is genuinely absent.
  const bp = balance?.buyingPower;
  if (bp != null && Number.isFinite(Number(bp))) {
    return Math.max(0, Number(bp) - reserved);
  }
  return 0;
}
