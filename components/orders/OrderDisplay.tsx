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
  let steps: { label: string; kind: 'done' | 'active' | 'future' | 'cancelled' | 'rejected' }[];
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
      { label: '⚠ Rejected', kind: 'rejected' },
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
        .step.cancelled { color: #8b96ab; }
        .step.rejected { color: #f97316; font-weight: 800; }
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

// Left-accent border color for an order card by STATUS (never by side).
// Spec: SELL badge carries red (red's only meaning = sell); the card accent is
// status-driven — cancelled is neutral slate/grey (NOT red), rejected is a
// heavier, more saturated red-orange (more alarming than a normal sell).
export function getOrderBorderColor(order: any): string {
  const s = (order.status || '').toLowerCase();
  if (s === 'rejected') return '#f97316'; // saturated red-orange
  if (s === 'cancelled') return '#64748b'; // neutral slate/grey
  if (s === 'filled') return '#10b981'; // success green
  if (s === 'open' || s === 'pending' || s === 'submitted') return '#f59e0b'; // amber
  return '#64748b';
}

// ─── Shared OrderCard — THE single order card (4-row spec) ────────────────────
// Rendered identically for solo orders AND basket child-legs across OrdersTab
// and TradeTab so the two surfaces can never drift.
//
//   Row 1: symbol + company name (left) · dollar amount + Est./Actual tag (right)
//   Row 2: type · TIF · qty (left) · BUY/SELL badge (right, under amount)
//   Row 3: Placed → Open → … stepper (left) · date/time (right)
//   Row 4: order ID + origin (left) · Cancel chip (right, cancellable only)
//
// Est vs Actual: for share (qty) orders the dollar amount is the estimate —
// "Est." (amber) while working, "Actual" (green) once filled. For dollar
// (notional) orders the share count is the estimate — "~" prefix in the meta
// line — and the dollar amount is the authoritative target until the real fill
// total lands. Reference price = limitPrice || currentPrice || fillPrice (the
// already-fetched placement quote — no new price-fetch dependency).

function filledAmount(o: any): number | null {
  const fq = Number(o?.filledQty ?? 0);
  const fp = Number(o?.filledPrice);
  if (fq > 0 && fp > 0 && Number.isFinite(fp)) return fq * fp;
  const tv = Number(o?.totalValue ?? 0);
  return tv > 0 ? tv : null;
}

function typeLabel(o: any): string {
  const t = String(o?.type || 'market').toLowerCase();
  const map: Record<string, string> = {
    market: 'Market',
    limit: 'Limit',
    stop: 'Stop',
    stop_limit: 'Stop Limit',
    stoplimit: 'Stop Limit',
  };
  return map[t] || t.charAt(0).toUpperCase() + t.slice(1);
}

export function OrderCard({
  order,
  companyName,
  showCancelChip = false,
  onCancel,
  inBasket = false,
}: {
  order: any;
  companyName?: string;
  showCancelChip?: boolean;
  onCancel?: (order: any) => void;
  inBasket?: boolean;
}) {
  const side = (order.side || '').toUpperCase();
  const isBuy = side === 'BUY';
  const status = (order.status || '').toLowerCase();
  const filled = status === 'filled';
  const working = ['open', 'pending', 'submitted'].includes(status);
  const unit = resolveRequested(order).unit;
  const r = resolveRequested(order);

  const cancellable = showCancelChip && working && !inBasket;

  // Row 1 right — dollar amount + Est./Actual tag.
  let amountValue: number;
  let tag: { label: string; color: string } | null = null;
  if (filled) {
    const fa = filledAmount(order);
    amountValue = fa != null && fa > 0 ? fa : orderAmount(order);
    tag = { label: 'Actual', color: '#3ddc97' };
  } else {
    amountValue = orderAmount(order);
    // qty (share) orders → the dollar amount is a derived estimate.
    if (working && unit === 'shares') tag = { label: 'Est.', color: '#f0b73f' };
  }
  const amountText = amountValue > 0 ? fmtDollars(amountValue) : '—';

  // Row 2 meta — type (with limit/stop price when set) · TIF · shares.
  const type = typeLabel(order);
  let typeToken = type;
  const lp = Number(order.limitPrice ?? 0);
  const sp = Number(order.stopPrice ?? 0);
  if (lp > 0 && (type === 'Limit' || type === 'Stop Limit')) typeToken = `${type} ${fmtDollars(lp)}`;
  else if (sp > 0 && (type === 'Stop' || type === 'Stop Limit')) typeToken = `${type} ${fmtDollars(sp)}`;
  const tif = String(order.timeInForce || 'DAY').toUpperCase();

  let sharesToken: string;
  if (filled) {
    const fq = Number(order.filledQty ?? 0);
    const fp = Number(order.filledPrice);
    sharesToken = fq > 0
      ? `${fmtShares(fq)} sh${fp > 0 ? ` @ ${fmtDollars(fp)}` : ''}`
      : formatSharesDisplay(orderShares(order));
  } else if (unit === 'dollars') {
    // dollar order → share count is the estimate ("~" prefix).
    const q = Number(r.requestedQty ?? 0);
    sharesToken = q > 0 ? `~${fmtShares(q)} share${q === 1 ? '' : 's'}` : '—';
  } else {
    const q = Number(order.qty ?? order.shares ?? 0);
    sharesToken = q > 0 ? `${fmtShares(q)} share${q === 1 ? '' : 's'}` : '—';
  }

  // Row 3 right — compact date/time.
  const dRaw = order.createdAt || order.date;
  const d = dRaw ? new Date(dRaw) : null;
  const dateLabel = d && !isNaN(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  // Row 4 left — order ref + source attribution.
  const ref = orderRef(order);
  const origin = orderOrigin(order);

  // Terminal-state reason (cancelled/rejected) + bracket SL/TP line.
  const reason = status === 'rejected' || status === 'cancelled'
    ? cancelReasonText(order)
    : '';
  const bracket = order.bracketOrder &&
    (order.bracketOrder.stopLoss || order.bracketOrder.takeProfit)
    ? `🛡️ SL ${fmtDollars(order.bracketOrder.stopLoss)} / TP ${fmtDollars(order.bracketOrder.takeProfit)}`
    : '';

  return (
    <div
      className="order-card"
      style={{ borderLeftColor: getOrderBorderColor(order) }}
    >
      {/* Row 1: symbol + name (left) · amount + Est./Actual tag (right) */}
      <div className="row1">
        <div className="head">
          <span className="sym">{order.symbol}</span>
          {companyName && <span className="name">{companyName}</span>}
        </div>
        <div className="amount-col">
          <span className="amount">{amountText}</span>
          {tag && <span className="tag" style={{ color: tag.color, borderColor: tag.color }}>{tag.label}</span>}
        </div>
      </div>

      {/* Row 2: meta (left) · BUY/SELL badge (right) */}
      <div className="row2">
        <div className="meta">
          {typeToken} · {tif} · {sharesToken}
        </div>
        <span className={`side-badge ${isBuy ? 'buy' : 'sell'}`}>{side}</span>
      </div>

      {/* Row 3: stepper (left) · date/time (right) */}
      <div className="row3">
        <div className="stepper-wrap">
          <OrderStepper order={order} />
        </div>
        {dateLabel && <span className="date">{dateLabel}</span>}
      </div>

      {reason && (
        <div className={`reason ${status === 'rejected' ? 'rejected' : ''}`}>
          {status === 'rejected' ? '⚠ ' : ''}{reason}
        </div>
      )}
      {bracket && <div className="bracket">{bracket}</div>}

      {/* Row 4: order ID + origin (left) · Cancel chip (right) */}
      <div className="bottom-row">
        <div className="bottom-left">
          <span className="ref">{ref}</span>
          {origin && <span className="origin">{origin}</span>}
        </div>
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
          padding: 12px 14px;
          margin-bottom: 10px;
        }
        .row1 { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .head { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .sym { font-size: 15px; font-weight: 700; color: #ffffff; line-height: 1.1; }
        .name {
          font-size: 11px; font-weight: 600; color: #94a3b8;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 50ch;
        }
        .amount-col { display: flex; align-items: center; gap: 6px; flex-shrink: 0; padding-top: 2px; }
        .amount {
          font-size: 14px; font-weight: 700; color: #e2e8f0;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .tag {
          font-size: 9px; font-weight: 700; letter-spacing: 0.02em;
          border: 1px solid; border-radius: 4px; padding: 1px 5px;
          text-transform: uppercase; white-space: nowrap;
        }
        .row2 { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; }
        .meta { font-size: 10.5px; color: var(--dim, #8b96ab); font-weight: 500; }
        .side-badge {
          border-radius: 4px; padding: 2px 7px; font-size: 10px; font-weight: 700;
          letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0;
        }
        .side-badge.buy { background: rgba(16,185,129,0.18); color: #10b981; }
        .side-badge.sell { background: rgba(239,68,68,0.18); color: #ef4444; }
        .row3 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .stepper-wrap { min-width: 0; flex: 1; }
        .date { font-size: 10px; color: #94a3b8; white-space: nowrap; flex-shrink: 0; }
        .bottom-row { display: flex; justify-content: space-between; align-items: center; margin-top: 9px; }
        .bottom-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .ref { font-size: 10px; color: #5c6579; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .origin { font-size: 9.5px; color: #8b96ab; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .reason { font-size: 11px; color: #8b96ab; margin-top: 8px; line-height: 1.4; }
        .reason.rejected { color: #f97316; font-weight: 600; }
        .bracket { font-size: 10px; color: #94a3b8; margin-top: 6px; }
        .cancel-chip {
          background: none; border: 1px solid rgba(239,68,68,0.4); border-radius: 6px;
          color: #ef4444; font-size: 11px; padding: 4px 10px; cursor: pointer;
          font-family: inherit; font-weight: 600; flex-shrink: 0;
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
