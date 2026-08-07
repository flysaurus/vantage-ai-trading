/**
 * Order Notification Emails
 *
 * Sends transactional emails for order events:
 *   - Order placed confirmation
 *   - Order filled notification
 *   - Order cancelled/rejected notification
 *
 * Uses the existing email infra (lib/email.ts) — SMTP in prod, Ethereal in dev.
 */

import { sendEmail } from '@/lib/email';
import type { OrderRequest, OrderResult, OrderImpactPreview } from '@/lib/broker/types';

const FROM_NAME = 'Vantage Trading';
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@vantage.test';

// ─── Send Order Confirmation ──────────────────────────────────

export interface OrderConfirmationParams {
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
    userEmail, userName, brokerName, symbol, side,
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
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:11px;color:#aaa">
        You received this email because you have order notifications enabled in Vantage.
        <a href="https://vantage-ai-trading.vercel.app/settings" style="color:#aaa">Unsubscribe</a>
      </p>
    </div>
  `;

  try {
    await sendEmail({
      to: userEmail,
      subject,
      html,
    });
    console.log(`[order-email] Sent ${side} confirmation for ${symbol} to ${userEmail}`);
  } catch (err) {
    console.error(
      '[order-email] Failed to send confirmation:',
      err instanceof Error ? err.message : 'Unknown',
    );
    // Don't throw — email failure should not block the order flow
  }
}

// ─── Send Order Fill Notification ─────────────────────────────

export interface OrderFillParams {
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
    userEmail, userName, brokerName, symbol, side,
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
    </div>
  `;

  try {
    await sendEmail({ to: userEmail, subject, html });
    console.log(`[order-email] Sent fill notification for ${symbol} to ${userEmail}`);
  } catch (err) {
    console.error('[order-email] Failed to send fill notification:', err);
  }
}
