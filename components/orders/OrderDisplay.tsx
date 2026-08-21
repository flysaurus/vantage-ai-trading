'use client';

// ─── OrderDisplay — shared order card primitives ─────────────────────────────
// Single source of truth for how an order is rendered across surfaces.
// Both OrdersTab (detailed card) and TradeTab (compact history row) consume
// these helpers + components so field-resolution and honest fallbacks live in
// exactly one place — the fix for the recurring "price unavailable"/"0 shares"
// divergence between the two previously-independent render paths.

import type { Order } from '@/types';
import {
  fmtShares,
  fmtDollars,
  authoritativeRequested,
  derivedRequested,
} from '@/lib/order-format';

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

/** Fill-price line: "$X.XX/share", or "Price pending" when filled w/o price, "Pending" when open. */
export function formatFillPriceDisplay(
  fillPrice: number | null | undefined,
  status: string,
): string {
  if (fillPrice != null && !isNaN(fillPrice) && fillPrice > 0) {
    return `$${Number(fillPrice).toFixed(2)}/share`;
  }
  const s = (status || '').toLowerCase();
  return s === 'filled' ? 'Price pending' : 'Pending';
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
  return order.source === 'ai_advisor' ? 'via AI Advisor' : 'Manual buy';
}

export function orderRef(order: Order): string {
  const bare = (order.brokerageOrderId || order.id).replace(/^demo-/, '');
  return '#' + bare.slice(0, 8);
}

export function OrderStepper({ order }: { order: Order }) {
  const s = order.status;
  const isFilled = s === 'filled';
  const isCancelled = s === 'cancelled';
  const isRejected = s === 'rejected';
  const isSubmitted = s === 'submitted';
  // 'open' and 'pending' both mean the order is confirmed working at the venue.
  const isOpen = s === 'open' || s === 'pending';

  const placedTime = formatStepTime(order.createdAt);

  // Middle step: Open (normal) → Cancelled/Rejected (diverged branch).
  let middleLabel = 'Open';
  let middleKind: 'done' | 'active' | 'cancelled' = 'active';
  let middleTime = '';
  if (isFilled) {
    middleKind = 'done';
    middleTime = formatStepTime(order.filledAt || order.updatedAt);
  } else if (isCancelled) {
    middleLabel = 'Cancelled';
    middleKind = 'cancelled';
    middleTime = formatStepTime(order.cancelledAt || order.updatedAt);
  } else if (isRejected) {
    middleLabel = 'Rejected';
    middleKind = 'cancelled';
    middleTime = formatStepTime(order.cancelledAt || order.updatedAt);
  } else if (isOpen) {
    middleKind = 'done';
    middleTime = formatStepTime(order.updatedAt || order.createdAt);
  } else {
    // submitted → still awaiting venue acknowledgement, keep "Open" as the active step.
    middleKind = 'active';
    middleTime = '';
  }

  // Filled step
  const filledTime = isFilled ? formatStepTime(order.filledAt) : '';
  const filledMuted = isCancelled || isRejected;
  const filledDot = isFilled ? '✓' : filledMuted ? '—' : '3';
  const filledDotClass = isFilled ? 'done' : '';

  // Connectors:
  //  Placed → middle: emerald once the order reached the middle step (open/filled/cancelled);
  //    red if REJECTED (diverged immediately after placement, never reached Open);
  //    faint while still SUBMITTED.
  const placedLineClass = isRejected ? 'cancelled' : isSubmitted ? '' : 'done';
  //  middle → Filled: emerald when filled; red when the branch terminated (cancelled/rejected);
  //    faint while still open/submitted.
  const middleLineClass = isFilled ? 'done' : isCancelled || isRejected ? 'cancelled' : '';

  return (
    <div className="stepper">
      <div className="step">
        <div className={`line ${placedLineClass}`} />
        <div className="dot done">✓</div>
        <div className="step-label done">Placed</div>
        <div className="step-time">{placedTime}</div>
      </div>
      <div className="step">
        <div className={`line ${middleLineClass}`} />
        <div className={`dot ${middleKind}`}>
          {middleKind === 'done' ? '✓' : middleKind === 'cancelled' ? '✕' : '●'}
        </div>
        <div className={`step-label ${middleKind}`}>{middleLabel}</div>
        <div className="step-time">{middleKind === 'active' ? (middleTime || 'pending') : middleTime}</div>
      </div>
      <div className="step" style={filledMuted ? { opacity: 0.35 } : undefined}>
        <div className={`dot ${filledDotClass}`}>{filledDot}</div>
        <div className={`step-label ${filledDotClass}`}>Filled</div>
        <div className="step-time">{filledTime}</div>
      </div>
      <style jsx>{`
        .stepper { display: flex; align-items: flex-start; margin: 14px 0 16px; }
        .step { display: flex; flex-direction: column; align-items: center; flex: 1; position: relative; }
        .dot {
          width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 800; z-index: 2; border: 2px solid #5c6579; background: #0a0e16; color: #5c6579;
        }
        .dot.done { border-color: #3ddc97; background: #3ddc97; color: #06110c; }
        .dot.active { border-color: #f0b73f; background: #0a0e16; color: #f0b73f; animation: pulse 1.6s ease-in-out infinite; }
        .dot.cancelled { border-color: #ef7b6a; background: #ef7b6a; color: #1a0a08; }
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(240,183,63,0.4);} 50%{box-shadow:0 0 0 5px rgba(240,183,63,0);} }
        .line { position: absolute; top: 10px; left: 50%; width: 100%; height: 2px; background: #5c6579; z-index: 1; }
        .line.done { background: #3ddc97; }
        .line.cancelled { background: #ef7b6a; }
        .step:last-child .line { display: none; }
        .step-label { font-size: 9.5px; color: #5c6579; margin-top: 6px; text-align: center; letter-spacing: 0.02em; }
        .step-label.done { color: #3ddc97; }
        .step-label.active { color: #f0b73f; font-weight: 700; }
        .step-label.cancelled { color: #ef7b6a; }
        .step-time { font-size: 8.5px; color: #5c6579; margin-top: 1px; }
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
