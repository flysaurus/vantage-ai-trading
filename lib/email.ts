// ─── Email Service ─────────────────────────────────────────────
// Priority: SendGrid API → SMTP → Ethereal (dev fallback)
//
// SendGrid (production): SENDGRID_API_KEY + FROM_EMAIL
//   - 100/day free forever, scales to paid plans
//   - Setup: sendgrid.com → API Keys → create "Mail Send" key
//   - Also verify a sender email: Settings → Sender Authentication
//
// SMTP (any provider): SMTP_HOST/PORT/USER/PASS
// Ethereal (dev): zero config, preview at ethereal.email

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vantage.test';
const FROM_NAME = 'Vantage';

// ── Transporter ──

let _transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (!_transporter) {
    const smtpHost = process.env.SMTP_HOST;

    if (smtpHost) {
      _transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      });
    } else {
      // Dev: Ethereal fake SMTP
      const testAccount = await nodemailer.createTestAccount();
      console.log('[email] 🔧 Ethereal:', testAccount.user);
      _transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
    }
  }
  return _transporter;
}

// ── Send ──

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  // Production: SendGrid REST API (preferred)
  if (SENDGRID_API_KEY) {
    return sendViaSendGrid({ to, subject, html });
  }

  // Dev: SMTP / Ethereal
  return sendViaSMTP({ to, subject, html });
}

async function sendViaSendGrid({ to, subject, html }: { to: string; subject: string; html: string }) {
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { name: FROM_NAME, email: FROM_EMAIL },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.json();
    const msg = body.errors?.[0]?.message || resp.statusText;
    console.error('[email] SendGrid failed:', msg);
    throw new Error(msg);
  }

  console.log('[email] ✅ SendGrid →', to);
  return { success: true, previewUrl: undefined as string | undefined };
}

async function sendViaSMTP({ to, subject, html }: { to: string; subject: string; html: string }) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
  if (previewUrl) {
    console.log('[email] 🔗 Preview:', previewUrl);
  }
  console.log('[email] ✅ SMTP →', to, '(id:', info.messageId, ')');
  return { success: true, id: info.messageId, previewUrl };
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
