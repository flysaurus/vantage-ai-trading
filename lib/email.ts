// ─── Email Service ──────────────────────────────────────────────
// Uses Resend for transactional emails: verification, password reset, 2FA codes.
// API key: RESEND_API_KEY in environment variables.

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || '');
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vantage-ai-trading.vercel.app';

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] ⚠️ RESEND_API_KEY not set — skipping email send');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('[email] ❌ Send failed:', error);
      throw new Error(error.message || 'Failed to send email');
    }

    console.log('[email] ✅ Sent to', to, '(id:', data?.id, ')');
    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[email] ❌ Unexpected error:', err);
    throw err;
  }
}

// ─── Email Templates ───────────────────────────────────────────

export function getVerificationEmailHTML(token: string, email: string): string {
  const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #7c3aed;">🦊 Vantage</h2>
  <h3>Verify your email address</h3>
  <p>Click the button below to verify your email and activate your Vantage account:</p>
  <a href="${verifyUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Verify Email</a>
  <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
</body>
</html>`;
}

export function getPasswordResetEmailHTML(token: string, email: string): string {
  const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #7c3aed;">🦊 Vantage</h2>
  <h3>Reset your password</h3>
  <p>Click the button below to reset your password. This link expires in 1 hour:</p>
  <a href="${resetUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Reset Password</a>
  <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
</body>
</html>`;
}
