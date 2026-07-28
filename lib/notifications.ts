// ─── Order Notifications ─────────────────────────────────────
// Sends email notifications for order lifecycle events.
//
// Provider: Gmail SMTP via nodemailer (lib/email.ts)
// Falls back to console.log if SMTP is not configured.
//
// TRIGGER POINTS:
//   1. Order acknowledged (submitted via DemoBroker.placeOrder)
//   2. Order executed (filled via DemoBroker or server-side cron)
//   3. Order cancelled (user-initiated or DAY-expired)
//
// Basket lifecycle:
//   - basket_submitted: order placed, waiting for market open
//   - basket_filled: all legs filled
//   - basket_partial_fill: some legs filled, some failed

// sendEmail() is imported dynamically to avoid bundling nodemailer (Node-only)
// into client-side code via the import chain:
//   notifications.ts → email.ts → nodemailer (dns, fs, net)

// ─── Order Notification Types ────────────────────────────────

interface OrderNotification {
  type: 'order_acknowledged' | 'order_filled' | 'order_cancelled';
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  shares: number;
  details?: string;
  fillPrice?: number;
  cancelReason?: 'user_cancelled' | 'day_expired';
  submittedPrice?: number;
  limitPrice?: number;
  stopPrice?: number;
}

export interface BasketNotification {
  type: 'basket_submitted' | 'basket_filled' | 'basket_partial_fill';
  basketId: string;
  basketName: string;
  basketEmoji: string;
  positions: Array<{
    symbol: string;
    shares: number;
    fillPrice: number;
    totalCost: number;
    status: 'filled' | 'failed';
  }>;
  totalInvested: number;
  filledCount: number;
  failedCount: number;
}

// ─── Subject Builders ────────────────────────────────────────

function buildOrderSubject(n: OrderNotification): string {
  const sym = n.symbol;
  switch (n.type) {
    case 'order_acknowledged':
      return `${n.side === 'BUY' ? 'Buy' : 'Sell'} order scheduled for ${sym}`;
    case 'order_filled':
      return `${n.side === 'BUY' ? 'Bought' : 'Sold'} ${sym}`;
    case 'order_cancelled':
      return `Canceled ${n.side === 'BUY' ? 'Buy' : 'Sell'} order for ${sym}`;
  }
}

function buildOrderHtml(n: OrderNotification): string {
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const typeLabel =
    n.type === 'order_acknowledged' ? 'Order Placed'
    : n.type === 'order_filled' ? 'Order Executed'
    : 'Order Cancelled';
  const typeColor =
    n.type === 'order_acknowledged' ? '#22d3ee'
    : n.type === 'order_filled' ? '#10b981'
    : '#ef4444';

  const sideLabel = n.side === 'BUY' ? 'Buy' : 'Sell';
  const sideColor = n.side === 'BUY' ? '#10b981' : '#ef4444';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #f8fafc; background: #0f172a; padding: 16px; border-radius: 8px; margin: 0 0 16px 0;">
        ${buildOrderSubject(n)}
      </h2>
      <div style="background: #1e293b; border-radius: 8px; padding: 20px; color: #cbd5e1;">
        <div style="background: ${typeColor}15; border: 1px solid ${typeColor}30; border-radius: 8px; padding: 12px; color: ${typeColor}; font-weight: 600; margin-bottom: 16px;">
          ${typeLabel}
        </div>
        <table style="width:100%; border-collapse: collapse;">
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Symbol</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">${n.symbol}</td>
          </tr>
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Order</td>
            <td style="padding: 8px 0; color: ${sideColor}; font-weight: 600; text-align: right;">${sideLabel} ${n.shares.toFixed(4)} shares</td>
          </tr>
          <tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Type</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">${n.orderType.replace(/_/g, ' ').toUpperCase()}</td>
          </tr>
          ${n.submittedPrice ? `<tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Price (submitted)</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">$${n.submittedPrice.toFixed(2)}</td>
          </tr>` : ''}
          ${n.limitPrice ? `<tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Limit Price</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">$${n.limitPrice.toFixed(2)}</td>
          </tr>` : ''}
          ${n.stopPrice ? `<tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Stop Price</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">$${n.stopPrice.toFixed(2)}</td>
          </tr>` : ''}
          ${n.fillPrice ? `<tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Fill Price</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">$${n.fillPrice.toFixed(2)}</td>
          </tr>` : ''}
          ${n.fillPrice ? `<tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Total</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">$${(n.fillPrice * n.shares).toFixed(2)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 0; color: #94a3b8;">Date / Time</td>
            <td style="padding: 8px 0; color: #f8fafc; font-weight: 600; text-align: right;">${now} ET</td>
          </tr>
          ${n.cancelReason ? `<tr style="border-bottom: 1px solid #334155;">
            <td style="padding: 8px 0; color: #94a3b8;">Reason</td>
            <td style="padding: 8px 0; color: #ef4444; font-weight: 600; text-align: right;">${n.cancelReason === 'day_expired' ? 'Day order expired' : 'Cancelled by user'}</td>
          </tr>` : ''}
          ${n.details ? `<tr><td colspan="2" style="padding: 8px 0; color: #94a3b8; font-size: 13px;">${n.details}</td></tr>` : ''}
        </table>
      </div>
      <p style="color: #64748b; font-size: 12px; margin-top: 16px; text-align: center;">
        Vantage · ${new Date().toISOString().split('T')[0]}
      </p>
    </div>
  `;
}

function buildBasketSubject(n: BasketNotification): string {
  const name = n.basketName || 'Basket';
  switch (n.type) {
    case 'basket_submitted':
      return `📊 Basket Order Placed: ${n.basketEmoji} ${name}`;
    case 'basket_filled':
      return `✅ Basket Filled: ${n.basketEmoji} ${name} — $${n.totalInvested.toFixed(2)}`;
    case 'basket_partial_fill':
      return `⚠️ Basket Partially Filled: ${n.basketEmoji} ${name} (${n.filledCount}/${n.filledCount + n.failedCount})`;
  }
}

function buildBasketHtml(n: BasketNotification): string {
  const rows = n.positions.map(p => {
    const icon = p.status === 'filled' ? '✅' : '❌';
    const color = p.status === 'filled' ? '#10b981' : '#ef4444';
    return `
      <tr style="border-bottom: 1px solid #1e293b;">
        <td style="padding: 6px 8px; color: ${color};">${icon}</td>
        <td style="padding: 6px 8px; color: #f8fafc; font-weight: 600;">${p.symbol}</td>
        <td style="padding: 6px 8px; color: #cbd5e1;">${p.shares.toFixed(4)}sh</td>
        <td style="padding: 6px 8px; color: #cbd5e1;">@ $${p.fillPrice.toFixed(2)}</td>
        <td style="padding: 6px 8px; color: #f8fafc;">$${p.totalCost.toFixed(2)}</td>
      </tr>`;
  }).join('');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #f8fafc; background: #0f172a; padding: 16px; border-radius: 8px; margin: 0 0 16px 0;">
        ${buildBasketSubject(n)}
      </h2>
      <div style="background: #1e293b; border-radius: 8px; padding: 20px; color: #cbd5e1;">
        <p style="margin: 0 0 8px;">Basket: <strong style="color: #f8fafc;">${n.basketEmoji} ${n.basketName}</strong></p>
        <p style="margin: 0 0 8px;">Total Invested: <strong style="color: #f8fafc;">$${n.totalInvested.toFixed(2)}</strong></p>
        <p style="color: #10b981; margin: 0 0 4px;">Filled: ${n.filledCount} position${n.filledCount !== 1 ? 's' : ''}</p>
        ${n.failedCount > 0 ? `<p style="color: #ef4444; margin: 0 0 8px;">Failed: ${n.failedCount} position${n.failedCount !== 1 ? 's' : ''}</p>` : ''}
        <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
          <thead>
            <tr style="border-bottom: 1px solid #334155;">
              <th style="text-align: left; padding: 6px 8px; color: #64748b; font-size: 11px;"></th>
              <th style="text-align: left; padding: 6px 8px; color: #64748b; font-size: 11px;">Symbol</th>
              <th style="text-align: left; padding: 6px 8px; color: #64748b; font-size: 11px;">Shares</th>
              <th style="text-align: left; padding: 6px 8px; color: #64748b; font-size: 11px;">Price</th>
              <th style="text-align: left; padding: 6px 8px; color: #64748b; font-size: 11px;">Cost</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="color: #64748b; font-size: 12px; margin-top: 16px; text-align: center;">
        Vantage · ${new Date().toISOString().split('T')[0]}
      </p>
    </div>
  `;
}

// ─── Send Functions ──────────────────────────────────────────

const SMTP_CONFIGURED =
  typeof process !== 'undefined' && !!(process.env?.SMTP_HOST && process.env?.SMTP_USER);

/**
 * Send an order lifecycle notification via Gmail SMTP.
 * Falls back to console.log when SMTP is not configured.
 */
export async function sendOrderNotification(
  userEmail: string,
  notification: OrderNotification,
): Promise<boolean> {
  if (!userEmail || !userEmail.includes('@')) {
    console.log('[notifications] No valid email, skipping:', notification.orderId);
    return false;
  }

  const subject = buildOrderSubject(notification);
  const html = buildOrderHtml(notification);

  if (SMTP_CONFIGURED) {
    try {
      // Dynamic import to keep nodemailer (Node-only) out of client bundles
      const { sendEmail } = await import('@/lib/email');
      const result = await sendEmail({ to: userEmail, subject, html });
      console.log(`[notifications] ✅ Order email sent → ${userEmail}: ${subject}`);
      return result.success;
    } catch (err: any) {
      console.error(`[notifications] SMTP send failed for ${notification.orderId}:`, err.message);
      return false;
    }
  }

  // Dev fallback
  console.log(`[notifications] (dev) Would send to ${userEmail}: ${subject}`);
  console.log(`[notifications] (dev) Order: ${notification.orderType} ${notification.side} ${notification.shares} ${notification.symbol}`);
  if (notification.fillPrice) console.log(`[notifications] (dev) Fill: $${notification.fillPrice.toFixed(2)}`);
  return true;
}

/**
 * Send a basket lifecycle notification via Gmail SMTP.
 * Falls back to console.log when SMTP is not configured.
 */
export async function sendBasketNotification(
  userEmail: string,
  notification: BasketNotification,
): Promise<void> {
  if (!userEmail || !userEmail.includes('@')) {
    console.log('[notifications] No valid email, skipping basket notification:', notification.basketId);
    return;
  }

  const subject = buildBasketSubject(notification);
  const html = buildBasketHtml(notification);

  if (SMTP_CONFIGURED) {
    try {
      // Dynamic import to keep nodemailer (Node-only) out of client bundles
      const { sendEmail } = await import('@/lib/email');
      await sendEmail({ to: userEmail, subject, html });
      console.log(`[notifications] ✅ Basket email sent → ${userEmail}: ${subject}`);
    } catch (err: any) {
      console.error(`[notifications] SMTP basket send failed:`, err.message);
    }
    return;
  }

  // Dev fallback
  console.log(`[notifications] (dev) Would send to ${userEmail}: ${subject}`);
  console.log(`[notifications] (dev) Basket: ${notification.basketName}, $${notification.totalInvested.toFixed(2)}, ${notification.filledCount}/${notification.positions.length} filled`);
}
