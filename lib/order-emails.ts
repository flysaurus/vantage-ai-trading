/**
 * Order Notification Emails
 *
 * Sends transactional emails for the full order lifecycle (10 event kinds):
 *   placed, filled, partially_filled, rejected (immediate), 4 cancellation
 *   variants (user / broker / external / stale-guard), cancel-rejected-
 *   because-already-filled, and consolidated baskets.
 *
 * Uses the existing email infra (lib/email.ts) — SMTP in prod, Ethereal in dev.
 *
 * Rules (locked product decisions):
 *   - ALWAYS-ON: no unsubscribe link/footer and no opt-out gate. These are
 *     transactional, distinct from the optional daily digest (which keeps its
 *     own unsubscribe flow).
 *   - DEMO EXCLUSION: demo orders (is_demo = true → isLive = false) send
 *     NOTHING. Real-broker orders only.
 *   - GENERIC: every template is BUY/SELL agnostic.
 *   - ROUNDING: share counts are rounded exactly like OrdersTab (4dp, trailing
 *     zeros stripped) — never raw 18-decimal values.
 *
 * notifyOrderEvent() is the single entry point for order events; it resolves
 * the user's email from public.users, skips demo, then dispatches. It never
 * throws — email failures must not block the order flow.
 *
 * notifyBasketEvent() is the equivalent for consolidated basket actions.
 */

import { sendEmail } from '@/lib/email';

// ─── Rounding helpers (mirror OrdersTab) ─────────────────────

function fmtShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function fmtDollars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toFixed(2)}%`;
}

// ─── Four-field requested display ────────────────────────────
// Authoritative field bold; derived estimate labeled + muted.

export interface RequestedFields {
  orderUnit?: 'dollars' | 'shares' | null;
  requestedAmount?: number | null;
  requestedQty?: number | null;
}

function resolveUnit(f: RequestedFields): 'dollars' | 'shares' {
  if (f.orderUnit === 'dollars' || f.orderUnit === 'shares') return f.orderUnit;
  return f.requestedAmount != null && f.requestedAmount > 0 ? 'dollars' : 'shares';
}

/** Returns the authoritative requested string (bold) — no derived estimate. */
function authoritativeRequested(f: RequestedFields): string {
  if (resolveUnit(f) === 'dollars') {
    return fmtDollars(f.requestedAmount);
  }
  const q = f.requestedQty;
  const n = q != null && q > 0 ? Number(q) : 0;
  return n > 0 ? `${fmtShares(n)} share${n === 1 ? '' : 's'}` : '—';
}

/** Returns the derived estimate string (muted) if any, else '' (HTML). */
function derivedRequested(f: RequestedFields): string {
  if (resolveUnit(f) === 'dollars') {
    return f.requestedQty != null && f.requestedQty > 0
      ? `≈${fmtShares(f.requestedQty)} shares est.`
      : '';
  }
  return f.requestedAmount != null && f.requestedAmount > 0
    ? `≈${fmtDollars(f.requestedAmount)} est.`
    : '';
}

/** Full requested line: "<strong>authoritative</strong> (derived)". */
function requestedLine(f: RequestedFields): string {
  const auth = authoritativeRequested(f);
  const deriv = derivedRequested(f);
  const derivHtml = deriv
    ? ` <span style="color:#888;font-weight:400">(${deriv})</span>`
    : '';
  return `<strong>${auth}</strong>${derivHtml}`;
}

// ─── Shared layout ───────────────────────────────────────────

const SIDE_COLOR = (side: 'BUY' | 'SELL') => (side === 'BUY' ? '#16a34a' : '#dc2626');

function wrap(inner: string): string {
  return `<div style="max-width:600px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b">${inner}</div>`;
}

function tableRow(label: string, value: string, shaded = false, valueColor?: string): string {
  const bg = shaded ? 'background:#f5f5f5;' : '';
  const color = valueColor ? `color:${valueColor};` : '';
  return `<tr><td style="padding:6px 12px;${bg}font-weight:bold;width:160px">${label}</td><td style="padding:6px 12px;${bg}${color}">${value}</td></tr>`;
}

// ─── Event payload types ─────────────────────────────────────

interface BaseEvent extends RequestedFields {
  brokerName: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderId: string;
  isLive: boolean;
  userName?: string;
}

export type OrderEmailEvent =
  | (BaseEvent & {
      kind: 'placed';
      type: string;
      limitPrice?: number;
      stopPrice?: number;
      estimatedTotal?: number;
    })
  | (BaseEvent & {
      kind: 'filled';
      fillQty: number;
      fillPrice: number;
      fillTotal: number;
    })
  | (BaseEvent & {
      kind: 'partially_filled';
      fillQty: number;
      fillPrice: number;
      fillTotal: number;
      remainingQty: number;
    })
  | (BaseEvent & {
      kind: 'rejected';
      reason?: string;
    })
  | (BaseEvent & {
      kind: 'cancelled';
      cancelReason: 'user_cancelled' | 'broker' | 'external' | 'stale_guard';
    })
  | (BaseEvent & {
      kind: 'cancel_rejected_filled';
      fillQty: number;
      fillPrice: number;
      fillTotal: number;
    });

export interface BasketPositionSummary extends RequestedFields {
  symbol: string;
  side: 'BUY' | 'SELL';
  status?: string;
  fillPrice?: number | null;
}

export interface BasketOrderEvent {
  brokerName: string;
  basketName: string;
  basketEmoji?: string;
  event: 'placed' | 'filled' | 'partially_filled' | 'cancelled';
  positions: BasketPositionSummary[];
  isLive: boolean;
  userName?: string;
  orderIds?: string[];
}

// ─── 1. Placed ───────────────────────────────────────────────

async function sendPlaced(e: Extract<OrderEmailEvent, { kind: 'placed' }>, email: string): Promise<void> {
  const greeting = e.userName ? `Hi ${e.userName},` : 'Hi,';
  const priceNote = e.limitPrice
    ? ` at $${e.limitPrice.toFixed(2)}`
    : e.stopPrice
      ? ` (stop: $${e.stopPrice.toFixed(2)})`
      : '';

  const subject = `[Vantage] ${e.side} ${e.symbol} — Order Submitted`;
  const html = wrap(`
    <h2 style="margin:0 0 12px">📊 Order Submitted</h2>
    <p>${greeting}</p>
    <p>Your order was sent to <strong>${e.brokerName}</strong>:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      ${tableRow('Symbol', e.symbol, false)}
      ${tableRow('Action', `${e.side}`, true, SIDE_COLOR(e.side))}
      ${tableRow('Requested', requestedLine(e), false)}
      ${e.type ? tableRow('Type', e.type.toUpperCase(), true) : ''}
      ${e.limitPrice ? tableRow('Limit', fmtDollars(e.limitPrice), false) : ''}
      ${e.stopPrice ? tableRow('Stop', fmtDollars(e.stopPrice), false) : ''}
      ${e.estimatedTotal != null && e.estimatedTotal > 0 ? tableRow('Est. Total', fmtDollars(e.estimatedTotal), true) : ''}
      ${tableRow('Broker', e.brokerName, false)}
    </table>
    <p style="font-size:12px;color:#888">Order ID: ${e.orderId.slice(0, 12)}…</p>
    <p style="font-size:12px;color:#888">
      Execution is not guaranteed. You'll receive a follow-up email once this order
      fills, partially fills, or is cancelled. Please verify directly with ${e.brokerName} if unsure.
    </p>
  `);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[order-email] Sent ${e.side} submission for ${e.symbol}`);
  } catch (err) {
    console.error('[order-email] Failed to send submission:', err);
  }
}

// ─── 2. Filled ───────────────────────────────────────────────

async function sendFilled(e: Extract<OrderEmailEvent, { kind: 'filled' }>, email: string): Promise<void> {
  const greeting = e.userName ? `Hi ${e.userName},` : 'Hi,';
  const pnlNote = e.side === 'BUY' ? 'Now in your portfolio' : 'Proceeds added to your account';

  const subject = `[Vantage] ✅ ${e.side} ${e.symbol} — Filled`;
  const html = wrap(`
    <h2 style="margin:0 0 12px">✅ Order Filled</h2>
    <p>${greeting}</p>
    <p>Your order was filled at <strong>${e.brokerName}</strong>:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      ${tableRow('Symbol', e.symbol, false)}
      ${tableRow('Action', `${e.side}`, true, SIDE_COLOR(e.side))}
      ${tableRow('Requested', requestedLine(e), false)}
      ${tableRow('Filled', `${fmtShares(e.fillQty)} share${Number(e.fillQty) === 1 ? '' : 's'} @ ${fmtDollars(e.fillPrice)}`, true)}
      ${tableRow('Total', fmtDollars(e.fillTotal), false)}
    </table>
    <p>${pnlNote}.</p>
    <p style="font-size:12px;color:#888">Order ID: ${e.orderId.slice(0, 12)}…</p>
  `);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[order-email] Sent fill for ${e.symbol}`);
  } catch (err) {
    console.error('[order-email] Failed to send fill:', err);
  }
}

// ─── 3. Partially Filled ─────────────────────────────────────

async function sendPartiallyFilled(e: Extract<OrderEmailEvent, { kind: 'partially_filled' }>, email: string): Promise<void> {
  const greeting = e.userName ? `Hi ${e.userName},` : 'Hi,';
  const filledShares = Number(e.fillQty);
  const remainingShares = Number(e.remainingQty || 0);

  const subject = `[Vantage] ⏳ ${e.side} ${e.symbol} — Partially Filled`;
  const html = wrap(`
    <h2 style="margin:0 0 12px">⏳ Partially Filled</h2>
    <p>${greeting}</p>
    <p>Part of your order was filled at <strong>${e.brokerName}</strong> — it is <strong>not yet complete</strong>:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      ${tableRow('Symbol', e.symbol, false)}
      ${tableRow('Action', `${e.side}`, true, SIDE_COLOR(e.side))}
      ${tableRow('Requested', requestedLine(e), false)}
      ${tableRow('Filled', `${fmtShares(e.fillQty)} share${filledShares === 1 ? '' : 's'} @ ${fmtDollars(e.fillPrice)}`, true)}
      ${tableRow('Filled Total', fmtDollars(e.fillTotal), false)}
      ${remainingShares > 0 ? tableRow('Remaining', `${fmtShares(e.remainingQty)} share${remainingShares === 1 ? '' : 's'} open`, true) : ''}
    </table>
    <p style="font-size:12px;color:#888">Order ID: ${e.orderId.slice(0, 12)}…</p>
    <p style="font-size:12px;color:#888">The remaining portion is still open. You'll get another update when it resolves.</p>
  `);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[order-email] Sent partial fill for ${e.symbol}`);
  } catch (err) {
    console.error('[order-email] Failed to send partial fill:', err);
  }
}

// ─── 4. Immediate Rejection ──────────────────────────────────

async function sendRejected(e: Extract<OrderEmailEvent, { kind: 'rejected' }>, email: string): Promise<void> {
  const greeting = e.userName ? `Hi ${e.userName},` : 'Hi,';
  const reason = e.reason?.trim() || 'No reason provided by the broker';

  const subject = `[Vantage] ⚠️ ${e.side} ${e.symbol} — Order Not Accepted`;
  const html = wrap(`
    <h2 style="margin:0 0 12px">⚠️ Order Not Accepted</h2>
    <p>${greeting}</p>
    <p>Your order was <strong>not accepted</strong> by ${e.brokerName}:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      ${tableRow('Symbol', e.symbol, false)}
      ${tableRow('Action', `${e.side}`, true, SIDE_COLOR(e.side))}
      ${tableRow('Requested', requestedLine(e), false)}
      ${tableRow('Reason', reason, true)}
    </table>
    <p style="font-size:12px;color:#888">Order ID: ${e.orderId.slice(0, 12)}…</p>
    <p style="font-size:12px;color:#888">No trade was executed. You can retry once the issue is resolved.</p>
  `);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[order-email] Sent rejection for ${e.symbol}`);
  } catch (err) {
    console.error('[order-email] Failed to send rejection:', err);
  }
}

// ─── 5–8. Cancelled variants ─────────────────────────────────

function cancelReasonLine(reason: 'user_cancelled' | 'broker' | 'external' | 'stale_guard', brokerName: string): string {
  switch (reason) {
    case 'user_cancelled':
      return 'It was cancelled at your request in Vantage.';
    case 'broker':
      return `It was rejected or expired at ${brokerName} (not cancelled in Vantage).`;
    case 'external':
      return 'It was cancelled outside Vantage (directly at your brokerage, or the order expired).';
    case 'stale_guard':
      return `We could no longer confirm this order's status with ${brokerName} after 2 days and marked it cancelled — please verify directly with ${brokerName} if you're unsure.`;
  }
}

async function sendCancelled(e: Extract<OrderEmailEvent, { kind: 'cancelled' }>, email: string): Promise<void> {
  const greeting = e.userName ? `Hi ${e.userName},` : 'Hi,';
  const reason = cancelReasonLine(e.cancelReason, e.brokerName);
  const heading = e.cancelReason === 'stale_guard' ? 'Order Marked Cancelled' : 'Order Cancelled';

  const subject = `[Vantage] ❌ ${e.side} ${e.symbol} — ${heading}`;
  const html = wrap(`
    <h2 style="margin:0 0 12px">❌ ${heading}</h2>
    <p>${greeting}</p>
    <p>Your order was cancelled at <strong>${e.brokerName}</strong>:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      ${tableRow('Symbol', e.symbol, false)}
      ${tableRow('Action', `${e.side}`, true, SIDE_COLOR(e.side))}
      ${tableRow('Requested', requestedLine(e), false)}
    </table>
    <p style="font-size:13px;color:#555">${reason}</p>
    <p style="font-size:12px;color:#888">Order ID: ${e.orderId.slice(0, 12)}…</p>
  `);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[order-email] Sent cancellation for ${e.symbol} (${e.cancelReason})`);
  } catch (err) {
    console.error('[order-email] Failed to send cancellation:', err);
  }
}

// ─── 6. Cancel rejected because already filled ───────────────

async function sendCancelRejectedFilled(e: Extract<OrderEmailEvent, { kind: 'cancel_rejected_filled' }>, email: string): Promise<void> {
  const greeting = e.userName ? `Hi ${e.userName},` : 'Hi,';
  const pnlNote = e.side === 'BUY' ? 'Now in your portfolio' : 'Proceeds added to your account';

  const subject = `[Vantage] ✅ ${e.side} ${e.symbol} — Filled (Cancel Unavailable)`;
  const html = wrap(`
    <h2 style="margin:0 0 12px">✅ Order Filled — Cancel Unavailable</h2>
    <p>${greeting}</p>
    <p>Your cancel request could not be completed: the order had <strong>already filled</strong> at ${e.brokerName} before the cancel reached it.</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      ${tableRow('Symbol', e.symbol, false)}
      ${tableRow('Action', `${e.side}`, true, SIDE_COLOR(e.side))}
      ${tableRow('Requested', requestedLine(e), false)}
      ${tableRow('Filled', `${fmtShares(e.fillQty)} share${Number(e.fillQty) === 1 ? '' : 's'} @ ${fmtDollars(e.fillPrice)}`, true)}
      ${tableRow('Total', fmtDollars(e.fillTotal), false)}
    </table>
    <p>${pnlNote}.</p>
    <p style="font-size:12px;color:#888">Order ID: ${e.orderId.slice(0, 12)}…</p>
  `);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[order-email] Sent cancel-rejected-filled for ${e.symbol}`);
  } catch (err) {
    console.error('[order-email] Failed to send cancel-rejected-filled:', err);
  }
}

// ─── 10. Basket (consolidated) ───────────────────────────────

const BASKET_EVENT_LABEL: Record<BasketOrderEvent['event'], string> = {
  placed: 'Basket Submitted',
  filled: 'Basket Filled',
  partially_filled: 'Basket Partially Filled',
  cancelled: 'Basket Cancelled',
};

const BASKET_EVENT_EMOJI: Record<BasketOrderEvent['event'], string> = {
  placed: '📊',
  filled: '✅',
  partially_filled: '⏳',
  cancelled: '❌',
};

async function sendBasket(e: BasketOrderEvent, email: string): Promise<void> {
  const greeting = e.userName ? `Hi ${e.userName},` : 'Hi,';
  const emoji = e.basketEmoji || '🧺';
  const title = e.basketName || 'Basket';

  const rows = e.positions
    .map((p, i) => {
      const requested = `${requestedLine(p)}`;
      const statusLabel = p.status ? ` — ${p.status}` : '';
      return `<tr>
        <td style="padding:6px 12px;${i % 2 === 1 ? 'background:#f5f5f5;' : ''}font-weight:bold">${p.symbol}</td>
        <td style="padding:6px 12px;${i % 2 === 1 ? 'background:#f5f5f5;' : ''}color:${SIDE_COLOR(p.side)}">${p.side}</td>
        <td style="padding:6px 12px;${i % 2 === 1 ? 'background:#f5f5f5;' : ''}">${requested}${statusLabel}</td>
      </tr>`;
    })
    .join('');

  const subject = `[Vantage] ${BASKET_EVENT_EMOJI[e.event]} ${emoji} ${title} — ${BASKET_EVENT_LABEL[e.event]}`;
  const html = wrap(`
    <h2 style="margin:0 0 12px">${BASKET_EVENT_EMOJI[e.event]} ${BASKET_EVENT_LABEL[e.event]}</h2>
    <p>${greeting}</p>
    <p>${emoji} <strong>${title}</strong> — one consolidated update for ${e.positions.length} position${e.positions.length === 1 ? '' : 's'} at <strong>${e.brokerName}</strong>:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
      <tr>
        <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #e5e7eb">Symbol</th>
        <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #e5e7eb">Action</th>
        <th style="padding:6px 12px;text-align:left;border-bottom:1px solid #e5e7eb">Requested</th>
      </tr>
      ${rows}
    </table>
    ${e.orderIds && e.orderIds.length ? `<p style="font-size:12px;color:#888">Order IDs: ${e.orderIds.map((id) => id.slice(0, 12)).join(', ')}…</p>` : ''}
    <p style="font-size:12px;color:#888">
      ${e.event === 'placed'
        ? 'Execution is not guaranteed. You\'ll receive follow-up emails as each position resolves.'
        : ''}
      Verify directly with ${e.brokerName} if unsure.
    </p>
  `);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[order-email] Sent basket ${e.event} for "${title}" (${e.positions.length} positions)`);
  } catch (err) {
    console.error('[order-email] Failed to send basket email:', err);
  }
}

// ─── Dispatchers ─────────────────────────────────────────────

async function resolveEmail(supabase: any, userId: string, fallbackEmail?: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('[order-email] Failed to fetch user email:', error.message);
      return null;
    }
    return data?.email || fallbackEmail || null;
  } catch (err) {
    console.error('[order-email] User lookup failed:', err);
    return null;
  }
}

/**
 * Single entry point for order lifecycle emails.
 *
 * Skips demo orders (isLive === false), resolves the user's email, then
 * dispatches to the correct template. Always-on (no opt-out, no unsubscribe).
 * Never throws.
 */
export async function notifyOrderEvent(
  supabase: any,
  userId: string,
  event: OrderEmailEvent,
  fallbackEmail?: string,
): Promise<void> {
  if (!event.isLive) {
    console.log('[order-email] Skipping demo order (isLive=false)');
    return;
  }

  const email = await resolveEmail(supabase, userId, fallbackEmail);
  if (!email || !email.includes('@')) return;

  try {
    switch (event.kind) {
      case 'placed':
        await sendPlaced(event, email);
        break;
      case 'filled':
        await sendFilled(event, email);
        break;
      case 'partially_filled':
        await sendPartiallyFilled(event, email);
        break;
      case 'rejected':
        await sendRejected(event, email);
        break;
      case 'cancelled':
        await sendCancelled(event, email);
        break;
      case 'cancel_rejected_filled':
        await sendCancelRejectedFilled(event, email);
        break;
    }
  } catch (err) {
    console.error('[order-email] notifyOrderEvent send failed:', err);
  }
}

/**
 * Consolidated basket email. Skips demo, resolves the user's email, sends ONE
 * email summarizing all positions. Never throws.
 */
export async function notifyBasketEvent(
  supabase: any,
  userId: string,
  event: BasketOrderEvent,
  fallbackEmail?: string,
): Promise<void> {
  if (!event.isLive) {
    console.log('[order-email] Skipping demo basket (isLive=false)');
    return;
  }

  const email = await resolveEmail(supabase, userId, fallbackEmail);
  if (!email || !email.includes('@')) return;

  try {
    await sendBasket(event, email);
  } catch (err) {
    console.error('[order-email] notifyBasketEvent send failed:', err);
  }
}

// Re-export shared helpers for reuse by the in-app bell writer (keeps
// rounding + requested-line formatting single-sourced).
export { fmtShares, fmtDollars, fmtPct, authoritativeRequested, derivedRequested, resolveUnit };
