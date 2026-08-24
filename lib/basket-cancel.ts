import { isWorkingStatus } from './order-format';

/**
 * A minimal view of an order sufficient to decide basket-cancel fan-out.
 * Matches the shape of orders held in the Zustand OrderStore (real SnapTrade)
 * and demo basket legs.
 */
export interface BasketLeg {
  id: string;
  status?: string | null;
  basketId?: string | null;
  basketOrderId?: string | null;
}

/**
 * Select the still-working legs of a basket.
 *
 * A "working" leg is one that could still fill or be cancelled
 * (open / pending / submitted). Filled and cancelled legs must NEVER be fanned
 * out to the cancel proxy — they have already settled at the broker and can
 * only be unwound by a separate sell, not a cancel.
 *
 * Matching: real SnapTrade basket legs share `basket_id` (surfaced as
 * `basketId`); the demo basket modal keys on `basketOrderId`. Accept either so
 * the Invest-tab group target and the demo modal both resolve correctly.
 */
export function selectWorkingBasketLegs(
  orders: readonly BasketLeg[],
  basketId: string,
): BasketLeg[] {
  return orders
    .filter((o) => o.basketId === basketId || o.basketOrderId === basketId)
    .filter((o) => isWorkingStatus(o.status));
}
