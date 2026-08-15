// lib/available-cash.ts
//
// SINGLE SOURCE OF TRUTH for "available cash" (spendable) across the app:
//   - Portfolio tab CASH tile
//   - TradeTicket "Available cash"
//   - AI Advisor budget checks
//
// Option C (user-confirmed 2026-08-15):
//   available_cash = buying_power ?? (cash − open reservations)
//
// Prefer the broker's buying_power when present — it already nets out open
// orders + settlement holds. Fall back to cash minus reserved open-order
// amounts for brokers/accounts that don't expose buying_power (e.g. demo).

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

    if (o.requestedAmount != null && Number(o.requestedAmount) > 0) {
      total += Number(o.requestedAmount);
    } else if (o.notional != null && Number(o.notional) > 0) {
      total += Number(o.notional);
    } else {
      const refPrice = Number(o.fillPrice ?? o.limitPrice ?? 0);
      const qty = Number(o.requestedQty ?? o.qty ?? 0);
      if (refPrice > 0 && qty > 0) total += qty * refPrice;
    }
  }
  return total;
}

/**
 * Available cash (spendable). Option C: buying_power ?? (cash − reservations).
 *
 * @param balance            cash + buyingPower (from broker.getAccount())
 * @param openReservedAmount SUM(requested_amount WHERE open) — only used in the
 *                           fallback path (when buying_power is absent).
 */
export function availableCash(
  balance: CashBalanceFields,
  openReservedAmount = 0,
): number {
  const bp = balance?.buyingPower;
  if (bp != null && Number.isFinite(Number(bp))) {
    return Number(bp);
  }
  const cash = Number(balance?.cash ?? 0);
  const reserved = Number(openReservedAmount) || 0;
  return Math.max(0, cash - reserved);
}
