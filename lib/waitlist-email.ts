// ─── Waitlist Confirmation Email ──────────────────────────────
// Server-only: only imported by API routes.
// Uses lib/email.ts (nodemailer → Gmail SMTP, same as Supabase Auth).

import { sendEmail } from './email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

function buildWaitlistSubject(): string {
  return "You're on the Vantage waitlist";
}

function buildWaitlistHtml(email: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #06b6d4, #3b82f6); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; font-size: 28px; margin: 0 0 8px 0;">Vantage</h1>
        <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0;">Your AI investing co-pilot</p>
      </div>
      <div style="background: #1e293b; border-radius: 0 0 12px 12px; padding: 24px; color: #cbd5e1;">
        <p style="font-size: 18px; margin: 0 0 24px 0; color: #f8fafc;">
          You're on the list.
        </p>
        <p style="font-size: 14px; margin: 0 0 24px 0; line-height: 1.8;">
          Vantage is invite-only. We've added you to the queue — you'll hear from us when your spot opens.
        </p>
        <ul style="font-size: 14px; line-height: 1.8; padding-left: 20px; margin: 0 0 24px 0;">
          <li>An AI Advisor that trades with you — bounce ideas off it, run real strategies like dollar-cost averaging and mean reversion</li>
          <li>Real execution underneath — market, limit, and stop orders that behave exactly like the real thing</li>
          <li>\$100k in demo capital to trade with real conviction and zero real risk</li>
          <li>Sync your real brokerage — Fidelity, Schwab, and more — for live portfolio visibility</li>
          <li>A scoring system that rewards being a good investor, not just an active one</li>
        </ul>
        <p style="font-size: 14px; margin: 0; color: #e2e8f0;">
          We'll reach out as soon as your spot is ready.
        </p>
        <p style="font-size: 12px; color: #e2e8f0; margin: 24px 0 0 0; text-align: center;">
          This email was sent to <strong>${email}</strong>. If you didn't request this, you can ignore it.
        </p>
      </div>
    </div>
  `;
}

/**
 * Send waitlist confirmation email via SMTP (lib/email.ts → nodemailer → Gmail).
 * Only called from API routes. Never imported by client code.
 */
export async function sendWaitlistEmail(email: string): Promise<boolean> {
  if (!email || !email.includes('@')) {
    console.error('[waitlist-email] Invalid email, skipping');
    return false;
  }

  try {
    await sendEmail({
      to: email,
      subject: buildWaitlistSubject(),
      html: buildWaitlistHtml(email),
    });
    console.log(`[waitlist-email] Sent waitlist confirmation to ${email}`);
    return true;
  } catch (err: any) {
    console.error(`[waitlist-email] Failed for ${email}:`, err.message);
    return false;
  }
}
