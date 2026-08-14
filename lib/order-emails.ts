/**
 * Order Notification Emails
 *
 * Sends transactional emails for order lifecycle events:
 *   - placed (order confirmation — "sent" merged into "placed" per state machine)
 *   - filled (execution confirmation)
 *   - cancelled (user-initiated, day-expired, or external/broker-side)
 *
 * Uses the existing email infra (lib/email.ts) — SMTP in prod, Ethereal in dev.
 * Unsubscribe is a one-click HMAC link (same scheme as the Portfolio Agent digest)
 * that flips users.order_emails_enabled → false via /api/order-emails/unsubscribe.
 *
 * notifyOrderEvent() is the single entry point call sites use: it resolves the
 * user's email + opt-out flag from the `users` table, then dispatches to the
 * right send function. It never throws — email failures must not block the
 * order flow.
 */

import { sendEmail } from '@/lib/email';
import { signUnsubscribeToken } from '@/lib/digest';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://vantage-ai-trading.vercel.app';

// ─── Unsubscribe footer (HMAC-signed, one-click, no login) ──

function buildUnsubscribeFooter(userId: string): string {
  const token = signUnsubscribeToken(userId);
  return `
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:11px;color:#aaa">
        You received this email because order notifications are enabled in Vantage.
        <a href="${BASE_URL}/api/order-emails/unsubscribe?token=${encodeURIComponent(token)}" style="color:#aaa;text-decoration:underline">Unsubscribe</a> — one click, no login.
      </p>`;
}

// ─── Placed ───────────────────────────────────────────────────

export interface OrderConfirmationParams {
  userId: string;
  userEmail: string;
  userName?: string;
  brokerName: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  shares: number;
  type: string;
  limitPrice?: number;
  stopPrice?: number;
  estimatedTotal: number;
  orderId: string;
  isLive: boolean; // true = real broker, false = demo
}

export async function sendOrderConfirmation(
  params: OrderConfirmationParams,
): Promise<void> {
  const {
    userId, userEmail, userName, brokerName, symbol, side,
    shares, type, limitPrice, stopPrice, estimatedTotal,
    orderId, isLive,
  } = params;

  const greeting = userName ? `Hi ${userName},` : 'Hi,';
  const env = isLive ? `via **${brokerName}**` : 'in your **Demo** account';
  const priceNote = limitPrice
    ? ` at $${limitPrice.toFixed(2)}`
    : stopPrice
      ? ` (stop: $${stopPrice.toFixed(2)})`
      : '';

  const subject = `[Vantage] ${side} ${shares} ${symbol}${priceNote} — Order Confirmed`;
  const html = `
    <div style="max-width:600px;font-family:sans-serif">
      <h2>📊 Order Confirmed</h2>
      <p>${greeting}</p>
      <p>Your order has been placed ${env}:</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Symbol</td><td style="padding:6px 12px">${symbol}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Action</td><td style="padding:6px 12px;color:${side === 'BUY' ? '#16a34a' : '#dc2626'}">${side} ${shares} shares</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Type</td><td style="padding:6px 12px">${type.toUpperCase()}</td></tr>
        ${limitPrice ? `<tr><td style="padding:6px 12px;font-weight:bold">Limit</td><td style="padding:6px 12px">$${limitPrice.toFixed(2)}</td></tr>` : ''}
        ${stopPrice ? `<tr><td style="padding:6px 12px;font-weight:bold">Stop</td><td style="padding:6px 12px">$${stopPrice.toFixed(2)}</td></tr>` : ''}
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Est. Total</td><td style="padding:6px 12px">$${estimatedTotal.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Broker</td><td style="padding:6px 12px">${brokerName}${isLive ? '' : ' (Demo)'}</td></tr>
      </table>
      <p style="font-size:12px;color:#888">Order ID: ${orderId.slice(0, 12)}...</p>
      <p style="font-size:12px;color:#888">
        ${isLive
          ? 'This order was sent to your brokerage. Execution is not guaranteed. Please verify in your brokerage account.'
          : 'This is a simulated Demo order. No real money was involved.'}
      </p>
      ${buildUnsubscribeFooter(userId)}
    </div>
  `;

  try {
    await sendEmail({ to: userEmail, subject, html });
    console.log(`[order-email] Sent ${side} confirmation for ${symbol} to ${userEmail}`);
  } catch (err) {
    console.error(
      '[order-email] Failed to send confirmation:',
      err instanceof Error ? err.message : 'Unknown',
    );
    // Don't throw — email failure should not block the order flow
  }
}

// ─── Filled ───────────────────────────────────────────────────

export interface OrderFillParams {
  userId: string;
  userEmail: string;
  userName?: string;
  brokerName: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  shares: number;
  fillPrice: number;
  totalCost: number;
  orderId: string;
  isLive: boolean;
}

export async function sendOrderFillNotification(
  params: OrderFillParams,
): Promise<void> {
  const {
    userId, userEmail, userName, brokerName, symbol, side,
    shares, fillPrice, totalCost, orderId, isLive,
  } = params;

  const greeting = userName ? `Hi ${userName},` : 'Hi,';
  const env = isLive ? `via **${brokerName}**` : 'in your **Demo** account';
  const pnlNote = side === 'BUY' ? 'Now in your portfolio' : 'Proceeds added to your account';

  const subject = `[Vantage] ✅ ${side} ${shares} ${symbol} Filled @ $${fillPrice.toFixed(2)}`;
  const html = `
    <div style="max-width:600px;font-family:sans-serif">
      <h2>✅ Order Filled</h2>
      <p>${greeting}</p>
      <p>Your order was filled ${env}:</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Symbol</td><td style="padding:6px 12px">${symbol}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Action</td><td style="padding:6px 12px;color:${side === 'BUY' ? '#16a34a' : '#dc2626'}">${side} ${shares} shares</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Fill Price</td><td style="padding:6px 12px">$${fillPrice.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Total</td><td style="padding:6px 12px">$${totalCost.toFixed(2)}</td></tr>
      </table>
      <p>${pnlNote}.</p>
      <p style="font-size:12px;color:#888">Order ID: ${orderId.slice(0, 12)}...</p>
      ${buildUnsubscribeFooter(userId)}
    </div>
  `;

  try {
    await sendEmail({ to: userEmail, subject, html });
    console.log(`[order-email] Sent fill notification for ${symbol} to ${userEmail}`);
  } catch (err) {
    console.error('[order-email] Failed to send fill notification:', err);
  }
}

// ─── Cancelled ────────────────────────────────────────────────

export interface OrderCancellationParams {
  userId: string;
  userEmail: string;
  userName?: string;
  brokerName: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  shares: number;
  orderId: string;
  isLive: boolean;
  /** Why it was cancelled — drives the user-facing reason line. */
  cancelReason?: 'user_cancelled' | 'day_expired' | 'external';
}

export async function sendOrderCancellation(
  params: OrderCancellationParams,
): Promise<void> {
  const {
    userId, userEmail, userName, brokerName, symbol, side,
    shares, orderId, isLive, cancelReason,
  } = params;

  const greeting = userName ? `Hi ${userName},` : 'Hi,';
  const env = isLive ? `at **${brokerName}**` : 'in your **Demo** account';
  const reason =
    cancelReason === 'day_expired'
      ? 'It was a day order and expired at market close.'
      : cancelReason === 'external'
        ? 'It was cancelled outside Vantage (directly at your brokerage, or the order expired).'
        : 'It was cancelled at your request.';

  const subject = `[Vantage] ❌ ${side} ${shares} ${symbol} — Cancelled`;
  const html = `
    <div style="max-width:600px;font-family:sans-serif">
      <h2>❌ Order Cancelled</h2>
      <p>${greeting}</p>
      <p>Your order was cancelled ${env}:</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Symbol</td><td style="padding:6px 12px">${symbol}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Action</td><td style="padding:6px 12px;color:#dc2626">${side} ${shares} shares</td></tr>
      </table>
      <p style="font-size:13px;color:#555">${reason}</p>
      <p style="font-size:12px;color:#888">Order ID: ${orderId.slice(0, 12)}...</p>
      ${buildUnsubscribeFooter(userId)}
    </div>
  `;

  try {
    await sendEmail({ to: userEmail, subject, html });
    console.log(`[order-email] Sent cancellation for ${symbol} to ${userEmail}`);
  } catch (err) {
    console.error('[order-email] Failed to send cancellation:', err);
  }
}

// ─── Dispatcher ───────────────────────────────────────────────

export type OrderEmailEvent =
  | ({ kind: 'placed' } & Omit<OrderConfirmationParams, 'userId' | 'userEmail' | 'userName'> & { userName?: string })
  | ({ kind: 'filled' } & Omit<OrderFillParams, 'userId' | 'userEmail' | 'userName'> & { userName?: string })
  | ({ kind: 'cancelled' } & Omit<OrderCancellationParams, 'userId' | 'userEmail' | 'userName'> & { userName?: string });

/**
 * Single entry point for order email dispatch.
 *
 * Resolves the user's email + opt-out flag from public.users, skips when the
 * user is opted out (or the column is missing — migration pending), then sends
 * the appropriate transactional email. Never throws.
 *
 * @param supabase   service-role Supabase client (any compatible client works)
 * @param userId     canonical user UUID (for preference lookup + HMAC token)
 * @param event      the lifecycle event to notify
 * @param fallbackEmail optional — used only if users.email is null (e.g. auth-only users)
 */
export async function notifyOrderEvent(
  supabase: any,
  userId: string,
  event: OrderEmailEvent,
  fallbackEmail?: string,
): Promise<void> {
  let email: string | null = null;
  let enabled = true;

  try {
    const { data: userRow, error } = await supabase
      .from('users')
      .select('email, order_emails_enabled')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      if (error.message?.includes('order_emails_enabled')) {
        console.log('[order-email] order_emails_enabled column missing — migration 044 pending. Skipping.');
      } else {
        console.error('[order-email] Failed to fetch user email:', error.message);
      }
      return;
    }

    email = userRow?.email || fallbackEmail || null;
    enabled = userRow?.order_emails_enabled !== false; // default true when null
  } catch (err) {
    console.error('[order-email] notifyOrderEvent user lookup failed:', err);
    return;
  }

  if (!email || !email.includes('@') || !enabled) return;

  try {
    switch (event.kind) {
      case 'placed':
        await sendOrderConfirmation({ userId, userEmail: email, ...event });
        break;
      case 'filled':
        await sendOrderFillNotification({ userId, userEmail: email, ...event });
        break;
      case 'cancelled':
        await sendOrderCancellation({ userId, userEmail: email, ...event });
        break;
    }
  } catch (err) {
    console.error('[order-email] notifyOrderEvent send failed:', err);
  }
}
