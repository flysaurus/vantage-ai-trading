// ─── computeBasketAggregateStatus ─────────────────────────────────────────────
// Given an array of child orders, determines basket-level aggregated status.
// This is derived, NEVER stored. The source of truth is always the children.
//
// Rules:
//   OPEN      = any child is working (open/pending/submitted) → Open tab
//   FILLED    = all children filled                           → Filled tab
//   PARTIAL   = mix of filled + cancelled, none working       → BOTH Filled & Cancelled tabs
//   CANCELLED = all children cancelled                        → Cancelled tab
//
// Also returns filledCount/totalCount for progress badges.

import { isWorkingStatus } from '@/lib/order-format';

export type BasketAggregateStatus = 'OPEN' | 'FILLED' | 'PARTIAL' | 'CANCELLED';

export interface BasketAggregateResult {
  status: BasketAggregateStatus;
  displayStatus: string;        // human-readable, e.g. "PARTIAL" → "Partial"
  filledCount: number;
  totalCount: number;
  // Which tabs should this basket appear in?
  tabs: ('open' | 'filled' | 'cancelled')[];
}

/**
 * Compute a basket's aggregate status from its child orders.
 * Each child must have at minimum a `status` field (string).
 */
export function computeBasketAggregateStatus(
  orders: { status: string }[],
): BasketAggregateResult {
  if (!orders || orders.length === 0) {
    return {
      status: 'OPEN',
      displayStatus: 'Open',
      filledCount: 0,
      totalCount: 0,
      tabs: ['open'],
    };
  }

  const total = orders.length;
  const filled = orders.filter((o) => o.status === 'filled').length;
  const cancelled = orders.filter((o) => o.status === 'cancelled').length;
  const rejected = orders.filter((o) => o.status === 'rejected').length;
  const working = orders.filter((o) => isWorkingStatus(o.status)).length;

  // If any child is still working → OPEN
  if (working > 0) {
    return {
      status: 'OPEN',
      displayStatus: 'Open',
      filledCount: filled,
      totalCount: total,
      tabs: ['open'],
    };
  }

  const terminal = filled + cancelled + rejected;

  // All filled → FILLED
  if (filled === total) {
    return {
      status: 'FILLED',
      displayStatus: 'Filled',
      filledCount: filled,
      totalCount: total,
      tabs: ['filled'],
    };
  }

  // All cancelled/rejected → CANCELLED
  if (cancelled + rejected === total) {
    return {
      status: 'CANCELLED',
      displayStatus: 'Cancelled',
      filledCount: filled,
      totalCount: total,
      tabs: ['cancelled'],
    };
  }

  // Mix of filled + cancelled, none working → PARTIAL
  // Appears in BOTH Filled and Cancelled tabs
  return {
    status: 'PARTIAL',
    displayStatus: 'Partial',
    filledCount: filled,
    totalCount: total,
    tabs: ['filled', 'cancelled'],
  };
}