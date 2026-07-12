// ─── Password Reset Emails ────────────────────────────────────
// Server-only: only imported by API routes, never by client code.
// Uses lib/email.ts (nodemailer → Gmail SMTP, same as Supabase Auth).

import { sendEmail } from './email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

function buildResetSubject(): string {
  return '[Vantage] Password reset link';
}

function buildResetHtml(resetToken: string, targetEmail: string): string {
  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #06b6d4, #3b82f6); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; font-size: 22px; margin: 0;">🔑 Vantage</h1>
      </div>
      <div style="background: #1e293b; border-radius: 0 0 12px 12px; padding: 24px; color: #cbd5e1;">
        <p style="font-size: 14px; margin: 0 0 24px 0; line-height: 1.6;">
          An admin requested a password reset for your account. Click below to set a new password.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${resetUrl}" style="display: inline-block; background: #06b6d4; color: #0a0f1e; padding: 12px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none;">Set new password →</a>
        </div>
        <p style="font-size: 13px; color: #94a3b8; margin: 24px 0 8px 0; text-align: center;">
          This link was sent to <strong>${targetEmail}</strong>.
        </p>
        <p style="font-size: 12px; color: #94a3b8; margin: 0; text-align: center;">
          Link expires in 24 hours. If you didn't request this, you can ignore it.
        </p>
      </div>
    </div>
  `;
}

/**
 * Send a password reset email via SMTP.
 * Only called from API routes. Never imported by client code.
 */
export async function sendResetEmail(
  email: string,
  resetToken: string,
): Promise<boolean> {
  if (!email || !email.includes('@')) {
    console.error('[reset-email] Invalid email, skipping');
    return false;
  }

  try {
    await sendEmail({
      to: email,
      subject: buildResetSubject(),
      html: buildResetHtml(resetToken, email),
    });
    console.log(`[reset-email] Sent password reset to ${email}`);
    return true;
  } catch (err: any) {
    console.error(`[reset-email] Failed for ${email}:`, err.message);
    return false;
  }
}
