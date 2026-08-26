'use client';

// ─── OrderDisplay — shared order card primitives ─────────────────────────────
// Single source of truth for how an order is rendered across surfaces.
// Both OrdersTab (detailed card) and TradeTab (compact history row) consume
// these helpers + components so field-resolution and honest fallbacks live in
// exactly one place — the fix for the recurring "price unavailable"/"0 shares"
// divergence between the two previously-independent render paths.

import { Fragment } from 'react';
import type { Order } from '@/types';
import {
  fmtShares,
  fmtDollars,
  authoritativeRequested,
  derivedRequested,
  cancelReasonText,
} from '@/lib/order-format';

export { cancelReasonText };

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function formatOrderDate(date: string) {
  const d = new Date(date);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
}

// (fmtShares / fmtDollars are imported from lib/order-format — single source
// of truth shared with the email + bell writers.)

// ─── Requested vs filled resolution ──────────────────────────────────────────
// The four-field model: order_unit decides which "requested" field is
// authoritative. The other is a labeled DERIVED ESTIMATE, never a bare number.

export function resolveRequested(order: Order) {
  const unit: 'dollars' | 'shares' =
    order.orderUnit ?? (order.notional != null && order.notional > 0 ? 'dollars' : 'shares');
  const requestedAmount = order.requestedAmount ?? (unit === 'dollars' ? order.notional : null);
  const requestedQty = order.requestedQty ?? (unit === 'shares' ? order.qty : (order.qty > 0 ? order.qty : null));
  return { unit, requestedAmount, requestedQty };
}

// ─── Honest fallback helpers (the anti-"price unavailable"/"0" rule) ─────────
// Never render "0" or a bare blank when the truthful state is "not yet
// available" — always say so explicitly.

/** Fill-price/status line: "$X.XX/share", or an honest status word when not filled. */
export function formatFillPriceDisplay(
  fillPrice: number | null | undefined,
  status: string,
): string {
  if (fillPrice != null && !isNaN(fillPrice) && fillPrice > 0) {
    return `$${Number(fillPrice).toFixed(2)}/share`;
  }
  const s = (status || '').toLowerCase();
  switch (s) {
    case 'filled': return 'Price pending';
    case 'cancelled': return 'Cancelled';
    case 'rejected': return 'Rejected';
    case 'open':
    case 'pending':
    case 'submitted': return 'Awaiting fill';
    default: return '';
  }
}

/** Share-count line: formatted count, or "—" when genuinely absent (never bare "0"). */
export function formatSharesDisplay(shares: number | null | undefined): string {
  if (shares == null || isNaN(shares) || shares <= 0) return '—';
  return fmtShares(shares);
}

// ─── Order Timeline Stepper ──────────────────────────────────────────────────

export function formatStepTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function orderOrigin(order: Order): string {
  // Three-way source attribution (Part 2 of the trust audit):
  //   external  → placed directly at the broker, synced into Vantage
  //   ai_advisor→ placed via the AI Advisor chat
  //   otherwise → placed manually through the Vantage trade ticket/sell
  if (order.origin === 'external') {
    return order.brokerName ? `Synced from ${order.brokerName}` : 'Synced from broker';
  }
  return order.source === 'ai_advisor' ? 'via AI Advisor' : 'Manual buy';
}

export function orderRef(order: Order): string {
  const bare = (order.brokerageOrderId || order.id).replace(/^demo-/, '');
  return '#' + bare.slice(0, 8);
}

export function OrderStepper({ order }: { order: Order }) {
  const s = (order.status || '').toLowerCase();

  // Single horizontal line of steps with arrow separators. Branches:
  //   filled         → Placed → Open → Filled
  //   open/pending   → Placed → Open → Filled (Filled = in-progress/amber)
  //   submitted      → Placed → Open → Filled (Open = in-progress/amber)
  //   cancelled      → Placed → Open → Cancelled  (Open happened; only Filled is ghost-omitted)
  //   rejected       → Placed → Rejected            (never reached Open; Filled ghost-omitted)
  let steps: { label: string; kind: 'done' | 'active' | 'future' | 'cancelled' }[];
  if (s === 'filled') {
    steps = [
      { label: 'Placed', kind: 'done' },
      { label: 'Open', kind: 'done' },
      { label: 'Filled', kind: 'done' },
    ];
  } else if (s === 'cancelled') {
    steps = [
      { label: 'Placed', kind: 'done' },
      { label: 'Open', kind: 'done' },
      { label: 'Cancelled', kind: 'cancelled' },
    ];
  } else if (s === 'rejected') {
    steps = [
      { label: 'Placed', kind: 'done' },
      { label: 'Rejected', kind: 'cancelled' },
    ];
  } else if (s === 'open' || s === 'pending') {
    steps = [
      { label: 'Placed', kind: 'done' },
      { label: 'Open', kind: 'done' },
      { label: 'Filled', kind: 'active' },
    ];
  } else {
    // submitted (and any unknown non-terminal) → awaiting venue acknowledgement
    steps = [
      { label: 'Placed', kind: 'done' },
      { label: 'Open', kind: 'active' },
      { label: 'Filled', kind: 'future' },
    ];
  }

  return (
    <div className="stepper">
      {steps.map((step, i) => (
        <Fragment key={step.label}>
          {i > 0 && <span className="arrow">→</span>}
          <span className={`step ${step.kind}`}>
            {step.kind !== 'future' && <span className="dot" />}
            {step.label}
          </span>
        </Fragment>
      ))}
      <style jsx>{`
        .stepper { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; flex-wrap: wrap; }
        .arrow { color: #5c6579; font-size: 11px; line-height: 1; }
        .step { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.01em; }
        .step .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
        .step.done { color: #3ddc97; }
        .step.active { color: #f0b73f; }
        .step.active .dot { animation: pulse 1.6s ease-in-out infinite; }
        .step.future { color: #5c6579; font-weight: 500; }
        .step.cancelled { color: #ef7b6a; }
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(240,183,63,0.4);} 50%{box-shadow:0 0 0 4px rgba(240,183,63,0);} }
      `}</style>
    </div>
  );
}

// ─── Amount / shares resolution (shared with TradeTab order cards) ──────────
// Total/requested dollar amount for an order — reads request-derived fields
// FIRST (totalCost / reservedCost / requestedAmount / notional) so cancelled
// legs show their original amount instead of "$0.00". Falls back to
// shares × price for plain share orders. Works for both the app `Order` shape
// and the broker/normalized order shape.
export function orderAmount(o: any): number {
  const candidates = [o?.totalCost, o?.reservedCost, o?.requestedAmount, o?.notional];
  for (const c of candidates) {
    if (typeof c === 'number' && c > 0) return c;
  }
  const shares = Number(o?.shares ?? o?.qty ?? o?.filledQty ?? o?.filledShares ?? 0);
  const px = Number(o?.fillPrice ?? o?.submittedPrice ?? o?.price ?? 0);
  return shares > 0 && px > 0 ? shares * px : 0;
}

// Original requested shares — for notional (dollar) orders, derive an estimate
// from amount / price so cancelled legs never render "0.00 shares".
export function orderShares(o: any): number {
  const q = Number(o?.requestedQty ?? o?.qty ?? o?.shares ?? 0);
  if (q > 0) return q;
  const amt = orderAmount(o);
  const px = Number(o?.fillPrice ?? o?.submittedPrice ?? o?.price ?? 0);
  if (amt > 0 && px > 0) return amt / px;
  return 0;
}

// Left-accent border color for an order card by side + status.
export function getOrderBorderColor(order: any): string {
  const side = (order.side || '').toUpperCase();
  const s = (order.status || '').toLowerCase();
  if (s === 'filled') return side === 'BUY' ? '#10b981' : '#ef4444';
  if (s === 'open' || s === 'pending' || s === 'submitted') return '#f59e0b';
  if (s === 'rejected') return '#f87171';
  return '#64748b';
}

// ─── Shared OrderCard — identical structure for solo + basket-child orders ──
// Top row: symbol + full name + BUY/SELL badge (left) · amount + date (right).
// Meta line: type · TIF · qty shares. Single-line stepper. Bottom row: order ID
// (left) + Cancel chip (right, cancellable + showCancelChip only).
export function OrderCard({
  order,
  companyName,
  showCancelChip = false,
  onCancel,
}: {
  order: any;
  companyName?: string;
  showCancelChip?: boolean;
  onCancel?: (order: any) => void;
}) {
  const side = (order.side || '').toUpperCase();
  const isBuy = side === 'BUY';
  const cancellable =
    showCancelChip && ['open', 'pending', 'submitted'].includes((order.status || '').toLowerCase());
  const ref = orderRef(order);
  const amount = orderAmount(order);
  const dateLabel = (order.createdAt || order.date)
    ? formatOrderDate(order.createdAt || order.date)
    : '';
  const status = (order.status || '').toLowerCase();
  const reason = status === 'rejected'
    ? cancelReasonText(order)
    : status === 'cancelled' && order.cancelReason
      ? cancelReasonText(order)
      : '';

  return (
    <div
      className="order-card"
      style={{ borderLeftColor: getOrderBorderColor(order) }}
    >
      {/* Top row: symbol + name + badge (left) · amount + date (right) */}
      <div className="top-row">
        <div className="top-left">
          <div className="symbol-line">
            <span className="sym">{order.symbol}</span>
            {companyName && <span className="name">{companyName}</span>}
            <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{side}</span>
          </div>
          <div className="meta">
            {(order.type || 'market').toLowerCase()}
            {' · '}{(order.timeInForce || 'DAY').toUpperCase()}
            {' · '}{formatSharesDisplay(orderShares(order))} shares
          </div>
        </div>
        <div className="top-right">
          <div className="amount">${amount.toFixed(2)}</div>
          {dateLabel && <div className="date">{dateLabel}</div>}
        </div>
      </div>

      <OrderStepper order={order} />

      {reason && <div className="reason">{reason}</div>}

      {/* Bottom row: order ID (left) · Cancel chip (right) */}
      <div className="bottom-row">
        <span className="ref">{ref}</span>
        {cancellable && (
          <button className="cancel-chip" onClick={() => onCancel?.(order)}>
            Cancel
          </button>
        )}
      </div>

      <style jsx>{`
        .order-card {
          background: var(--card-bg, #1a2235);
          border: 1px solid var(--card-border, rgba(255,255,255,0.08));
          border-left-width: 3px;
          border-left-style: solid;
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 10px;
        }
        .top-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .top-left { min-width: 0; flex: 1; }
        .symbol-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .sym { font-size: 13px; font-weight: 600; color: #ffffff; }
        .name { font-size: 10px; color: #94a3b8; }
        .side-badge { border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.03em; }
        .side-badge.buy { background: rgba(16,185,129,0.2); color: #10b981; }
        .side-badge.sell { background: rgba(239,68,68,0.2); color: #ef4444; }
        .meta { font-size: 10px; color: var(--dim, #8b96ab); margin-top: 3px; }
        .top-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
        .amount { font-size: 12px; font-weight: 700; color: #cbd5e1; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .date { font-size: 10px; color: #94a3b8; }
        .bottom-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
        .ref { font-size: 10px; color: #5c6579; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .reason { font-size: 10px; color: #5c6579; margin-top: 6px; }
        .cancel-chip {
          background: none; border: 1px solid rgba(239,68,68,0.4); border-radius: 6px;
          color: #ef4444; font-size: 11px; padding: 4px 10px; cursor: pointer;
          font-family: inherit; font-weight: 600;
        }
      `}</style>
    </div>
  );
}

export function RequestedFilledBlocks({ order }: { order: Order }) {
  const r = resolveRequested(order);
  const openNow = order.status === 'open' || order.status === 'pending' || order.status === 'submitted';

  // Single-source the "Requested $X (≈Y shares est.)" pattern via the shared
  // four-field helpers so in-app cards and emails can never diverge.
  const requestedFields = {
    orderUnit: r.unit,
    requestedAmount: r.requestedAmount,
    requestedQty: r.requestedQty,
  };
  const reqValue = authoritativeRequested(requestedFields);
  const reqEst = derivedRequested(requestedFields) || null;

  const fillQty = order.filledQty ?? order.qty;
  const fillPrice = order.filledPrice;
  const hasFill = fillQty != null && fillQty > 0 && fillPrice != null;
  const fillAmount = hasFill ? fillQty * fillPrice : null;

  return (
    <div className="data-row">
      <div className="data-block">
        <div className="k">Requested</div>
        <div className="v">{reqValue}</div>
        {reqEst && <div className="est-tag">{reqEst}</div>}
      </div>
      <div className={`data-block ${hasFill ? 'filled' : ''}`}>
        <div className="k">Filled</div>
        {hasFill ? (
          <>
            <div className="v">{fmtShares(fillQty)} sh @ {fmtDollars(fillPrice)}</div>
            <div className="est-tag" style={{ color: '#3ddc97' }}>{fmtDollars(fillAmount)} total</div>
          </>
        ) : (
          <div className="v muted">{openNow ? 'Awaiting broker' : 'Not filled'}</div>
        )}
      </div>
      <style jsx>{`
        .data-row { display: flex; gap: 10px; }
        .data-block { flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.1); border-radius: 11px; padding: 10px 12px; }
        .data-block .k { font-size: 9.5px; color: #5c6579; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
        .data-block .v { font-size: 14.5px; font-weight: 700; color: #eef2f7; }
        .data-block .v.muted { color: #8b96ab; font-weight: 600; font-size: 12.5px; font-style: italic; }
        .data-block.filled { border-color: rgba(61,220,151,0.3); background: rgba(61,220,151,0.04); }
        .data-block.filled .v { color: #3ddc97; }
        .est-tag { font-size: 9px; color: #5c6579; font-weight: 500; margin-top: 2px; }
      `}</style>
    </div>
  );
}

// ─── Inline detail row for expanded order cards ──────────────────────────────
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
      <span style={{ color: '#e2e8f0' }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
