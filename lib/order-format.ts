/**
 * order-format — single source of truth for order money/share formatting.
 *
 * THE fix for the recurring "two render paths, one gets fixed" bug: both the
 * in-app order cards AND every order email/bell template must format dollars
 * and share counts through these exact functions, so a rounding or field
 * change can never again diverge between surfaces.
 *
 * Consumers:
 *   - lib/order-emails.ts          (HTML email templates)
 *   - lib/order-notifications.ts   (in-app bell one-liners)
 *   - components/orders/OrderDisplay.tsx (in-app cards)
 *
 * Canonical semantics:
 *   - Null / undefined / non-finite → '—' (never a bare "0" or empty string).
 *   - Shares: 4 decimal places, trailing zeros stripped (never raw 18-dp).
 *   - Dollars: 2 decimal places.
 */

// ─── Number formatters ───────────────────────────────────────

export function fmtShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function fmtDollars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toFixed(2)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(2)}%`;
}

// ─── Four-field requested model ──────────────────────────────
// order_unit decides which "requested" field is authoritative; the other is a
// labeled DERIVED ESTIMATE, never a bare number.

export interface RequestedFields {
  orderUnit?: 'dollars' | 'shares' | null;
  requestedAmount?: number | null;
  requestedQty?: number | null;
}

export function resolveUnit(f: RequestedFields): 'dollars' | 'shares' {
  if (f.orderUnit === 'dollars' || f.orderUnit === 'shares') return f.orderUnit;
  return f.requestedAmount != null && f.requestedAmount > 0 ? 'dollars' : 'shares';
}

/** Authoritative requested string — no derived estimate. e.g. "$1,000.00" or "12.5 shares". */
export function authoritativeRequested(f: RequestedFields): string {
  if (resolveUnit(f) === 'dollars') {
    return fmtDollars(f.requestedAmount);
  }
  const q = f.requestedQty;
  const n = q != null && q > 0 ? Number(q) : 0;
  return n > 0 ? `${fmtShares(n)} share${n === 1 ? '' : 's'}` : '—';
}

/** Derived estimate string if any, else '' (e.g. "≈3.27 shares est." / "≈$1,000.00 est."). */
export function derivedRequested(f: RequestedFields): string {
  if (resolveUnit(f) === 'dollars') {
    return f.requestedQty != null && f.requestedQty > 0
      ? `≈${fmtShares(f.requestedQty)} shares est.`
      : '';
  }
  return f.requestedAmount != null && f.requestedAmount > 0
    ? `≈${fmtDollars(f.requestedAmount)} est.`
    : '';
}

// ─── Cancellation reason ──────────────────────────────────────
// Human reason for a cancelled/rejected order shown IN-APP. (The email
// templates have their own fuller cancelReasonLine in lib/order-emails.ts that
// includes the broker name; this is the concise card version.)
export function cancelReasonText(order: {
  status?: string;
  cancelReason?: string | null;
}): string {
  const s = (order.status || '').toLowerCase();
  if (s === 'rejected') {
    return 'Rejected by your broker before it could be opened.';
  }
  if (s !== 'cancelled') return '';
  switch (order.cancelReason) {
    case 'user_cancelled':
      return 'Cancelled by you.';
    case 'already_filled':
      return 'Your cancel didn\u2019t go through — the order had already filled.';
    case 'stale_guard':
      return 'Marked cancelled after we couldn\u2019t confirm status with your broker.';
    case 'external':
      return 'Cancelled outside Vantage (at your brokerage, or the order expired).';
    default:
      return 'Cancelled.';
  }
}

// ─── Status predicates ────────────────────────────────────────
// "Working" = an order still in flight (could still fill or be cancelled).
// The Open tab filter and the Cancel button both use this exact set, so a
// freshly-SUBMITTED order is immediately visible/actionable — never stranded.
export const WORKING_STATUSES = ['open', 'pending', 'submitted'] as const;

export function isWorkingStatus(status?: string | null): boolean {
  return WORKING_STATUSES.includes(
    (status || '').toLowerCase() as (typeof WORKING_STATUSES)[number],
  );
}
