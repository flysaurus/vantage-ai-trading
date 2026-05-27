// ─── Email Service (Gmail SMTP via Nodemailer) ─────────────────
// Zero third-party services. Uses your Gmail account + app password.
// No domain verification, no IP whitelist, no credit card, no limits.
//
// Setup:
// 1. Enable 2FA on your Google account (myaccount.google.com/security)
// 2. Generate App Password: Security → 2-Step Verification → App Passwords
//    Select "Mail" + "Other (Vantage)" → copy the 16-char password
// 3. Set GMAIL_USER + GMAIL_APP_PASSWORD env vars on Vercel
//
// Limits: Gmail allows 500 emails/day (personal), 2000/day (Workspace)

import nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const FROM_EMAIL = process.env.FROM_EMAIL || GMAIL_USER;
const FROM_NAME = 'Vantage';

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // TLS via STARTTLS
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    const msg = 'GMAIL_USER or GMAIL_APP_PASSWORD not set';
    console.warn('[email] ⚠️', msg, '— skipping email send');
    throw new Error(msg);
  }

  try {
    const info = await getTransporter().sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    });

    console.log('[email] ✅ Sent to', to, '(id:', info.messageId, ')');
    return { success: true, id: info.messageId };
  } catch (err: any) {
    console.error('[email] ❌ Send failed:', err.message);
    throw err;
  }
}

// ─── Email Templates ───────────────────────────────────────────

export function getVerificationEmailHTML(token: string, email: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verifyUrl = `${appUrl}/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const resetUrl = `${appUrl}/auth/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

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
