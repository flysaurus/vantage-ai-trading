// ─── Order Notifications ─────────────────────────────────────
// Sends email notifications for order lifecycle events.
//
// Provider: Resend (https://resend.com) — simple REST API, no SDK weight.
// Falls back to console.log if RESEND_API_KEY is not configured.
//
// TRIGGER POINTS:
//   1. Order acknowledged (submitted via DemoBroker.placeOrder)
//   2. Order executed (filled via DemoBroker or server-side cron)
//   3. Order cancelled (user-initiated or DAY-expired)
//
// To enable production email: set RESEND_API_KEY in Vercel env vars.
// Resend free tier: 100 emails/day. Upgrade path: $20/mo for 50k.
//
// SMS: not implemented yet. Would require Twilio ($0.0079/msg) or similar.
// If desired, add a `channel: 'sms'` option and `TWILIO_*` env vars.
// Flag as separate decision point — do not silently pick a provider.

interface OrderNotification {
  type: 'order_acknowledged' | 'order_filled' | 'order_cancelled';
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  shares: number;
  /** Fill/cancel reason details */
  details?: string;
  /** For filled: the execution price */
  fillPrice?: number;
  /** For cancelled: whether this was user-initiated or automatic */
  cancelReason?: 'user_cancelled' | 'day_expired';
  /** For acknowledged: the submitted price / limit / stop */
  submittedPrice?: number;
  limitPrice?: number;
  stopPrice?: number;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFICATION_FROM = process.env.NOTIFICATION_FROM || 'Vantage <notifications@vantageapp.ai>';

function buildSubject(n: OrderNotification): string {
  const sym = n.symbol.toUpperCase();
  const side = n.side === 'BUY' ? 'Buy' : 'Sell';
  switch (n.type) {
    case 'order_acknowledged': return `📊 ${side} Order Placed: ${sym} (${n.orderType})`;
    case 'order_filled': return `✅ ${side} Order Filled: ${sym} @ $${n.fillPrice?.toFixed(2)}`;
    case 'order_cancelled': return `❌ ${side} Order Cancelled: ${sym}`;
  }
}

function buildHtml(n: OrderNotification): string {
  const sym = n.symbol.toUpperCase();
  const typeLabel = n.orderType === 'market' ? 'Market' : n.orderType === 'limit' ? 'Limit' : n.orderType === 'stop' ? 'Stop' : 'Stop Limit';

  let detailsHtml = '';
  if (n.type === 'order_acknowledged') {
    detailsHtml = `
      <p>Order Type: <strong>${typeLabel}</strong></p>
      ${n.limitPrice ? `<p>Limit Price: <strong>$${n.limitPrice.toFixed(2)}</strong></p>` : ''}
      ${n.stopPrice ? `<p>Stop Price: <strong>$${n.stopPrice.toFixed(2)}</strong></p>` : ''}
      <p>Submitted Price: <strong>$${(n.submittedPrice || 0).toFixed(2)}</strong></p>
    `;
  } else if (n.type === 'order_filled') {
    detailsHtml = `
      <p>Execution Price: <strong>$${n.fillPrice?.toFixed(2)}</strong></p>
      <p>Total: <strong>$${(n.shares * (n.fillPrice || 0)).toFixed(2)}</strong></p>
    `;
  } else if (n.type === 'order_cancelled') {
    detailsHtml = `
      <p>Reason: <strong>${n.cancelReason === 'user_cancelled' ? 'Cancelled by you' : 'DAY order expired at market close'}</strong></p>
    `;
  }

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #f8fafc; background: #0f172a; padding: 16px; border-radius: 8px; margin: 0 0 16px 0;">
        ${buildSubject(n)}
      </h2>
      <div style="background: #1e293b; border-radius: 8px; padding: 20px; color: #cbd5e1;">
        <p>Order: <strong style="color: #f8fafc;">${n.orderId}</strong></p>
        <p>${n.side === 'BUY' ? 'Buy' : 'Sell'} <strong style="color: #f8fafc;">${n.shares} shares</strong> of <strong style="color: #f8fafc;">${sym}</strong></p>
        ${detailsHtml}
      </div>
      <p style="color: #64748b; font-size: 12px; margin-top: 16px; text-align: center;">
        Vantage · Demo Trading · ${new Date().toISOString().split('T')[0]}
      </p>
    </div>
  `;
}

/**
 * Send an order lifecycle notification to the user.
 * Uses Resend if configured, otherwise logs to console.
 * Returns true if notification was sent (or attempted and didn't fail).
 */
export async function sendOrderNotification(
  userEmail: string,
  notification: OrderNotification,
): Promise<boolean> {
  if (!userEmail || !userEmail.includes('@')) {
    console.log('[notifications] No valid email, skipping:', notification.orderId);
    return false;
  }

  const subject = buildSubject(notification);
  const html = buildHtml(notification);

  // ── Resend path ──
  if (RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: NOTIFICATION_FROM,
          to: [userEmail],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[notifications] Resend error for ${notification.orderId}:`, err);
        return false;
      }

      console.log(`[notifications] Sent "${subject}" to ${userEmail}`);
      return true;
    } catch (err: any) {
      console.error(`[notifications] Resend send failed for ${notification.orderId}:`, err.message);
      return false;
    }
  }

  // ── No provider configured: log to console (dev mode) ──
  console.log(`[notifications] (dev) Would send to ${userEmail}: ${subject}`);
  console.log(`[notifications] (dev) Order: ${notification.orderType} ${notification.side} ${notification.shares} ${notification.symbol}`);
  if (notification.fillPrice) console.log(`[notifications] (dev) Fill: $${notification.fillPrice.toFixed(2)}`);
  return true;
}

// ─── Invite Emails ────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

function buildInviteSubject(): string {
  return '🎯 You\'re invited to Vantage';
}

function buildInviteHtml(inviteToken: string, invitedEmail: string): string {
  const signupUrl = `${APP_URL}/create-account?invite=${inviteToken}`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #06b6d4, #3b82f6); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; font-size: 28px; margin: 0 0 8px 0;">🎯 Vantage</h1>
        <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0;">Your AI investing co-pilot</p>
      </div>
      <div style="background: #1e293b; border-radius: 0 0 12px 12px; padding: 24px; color: #cbd5e1;">
        <p style="font-size: 16px; margin: 0 0 16px 0;">You've been invited to join <strong style="color: #f8fafc;">Vantage</strong> — an AI-powered investing platform that matches your personal investing style.</p>
        <p style="font-size: 14px; margin: 0 0 24px 0;">Take a 2-minute quiz to discover your investor personality, then get stock picks, portfolio analysis, and trade recommendations tailored to <em>your</em> strategy.</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${signupUrl}" style="display: inline-block; background: #06b6d4; color: #0a0f1e; padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 16px; text-decoration: none;">Accept Invite →</a>
        </div>
        <p style="font-size: 13px; color: #64748b; margin: 24px 0 8px 0; text-align: center;">
          This invite was sent to <strong>${invitedEmail}</strong>.
        </p>
        <p style="font-size: 12px; color: #475569; margin: 0; text-align: center;">
          Link expires in 30 days. If you didn't expect this, you can ignore it.
        </p>
      </div>
    </div>
  `;
}

/**
 * Send an invite email to a user.
 * Uses the same Resend integration as order notifications.
 * Returns true if sent successfully (or logged in dev mode).
 */
export async function sendInviteEmail(
  email: string,
  inviteToken: string,
): Promise<boolean> {
  if (!email || !email.includes('@')) {
    console.error('[notifications] Invalid invite email, skipping');
    return false;
  }

  const subject = buildInviteSubject();
  const html = buildInviteHtml(inviteToken, email);

  if (RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: NOTIFICATION_FROM,
          to: [email],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[notifications] Resend error for invite to ${email}:`, err);
        return false;
      }

      console.log(`[notifications] Sent invite to ${email}`);
      return true;
    } catch (err: any) {
      console.error(`[notifications] Resend send failed for invite to ${email}:`, err.message);
      return false;
    }
  }

  // Dev mode: log instead of sending
  console.log(`[notifications] (dev) Would send invite to ${email}: ${subject}`);
  console.log(`[notifications] (dev) Token: ${inviteToken.substring(0, 8)}...`);
  return true;
}
