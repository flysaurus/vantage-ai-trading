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

function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
    'http://localhost:3000'
  );
}

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
  // Strip HTML tags for plain-text fallback (boosts deliverability)
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  // Production: SendGrid REST API (preferred)
  if (SENDGRID_API_KEY) {
    return sendViaSendGrid({ to, subject, html, text });
  }

  // Dev: SMTP / Ethereal
  return sendViaSMTP({ to, subject, html, text });
}

async function sendViaSendGrid({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email: to }],
      }],
      from: { name: FROM_NAME, email: FROM_EMAIL },
      reply_to: { name: FROM_NAME, email: FROM_EMAIL },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
      mail_settings: {
        bypass_list_management: { enable: false },
      },
      tracking_settings: {
        click_tracking: { enable: false },
        open_tracking: { enable: false },
      },
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

async function sendViaSMTP({ to, subject, html, text }: { to: string; subject: string; html: string; text: string }) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    text,
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
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email — Vantage</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,&apos;Segoe UI&apos;,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 32px 0;">
          <p style="font-size:28px;font-weight:800;color:#06b6d4;margin:0;letter-spacing:-0.5px;">Vantage</p>
          <p style="color:#94a3b8;font-size:13px;margin:4px 0 0;">AI-first trading, in your pocket</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="color:#f1f5f9;font-size:20px;margin:0 0 12px;">Verify your email address</h2>
          <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 24px;">Click the button below to verify your email and activate your Vantage account:</p>
          <table cellpadding="0" cellspacing="0">
            <tr><td align="center" style="border-radius:8px;background:#06b6d4;">
              <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">Verify Email</a>
            </td></tr>
          </table>
          <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;">
            This link expires in 24 hours. If you didn&apos;t create this account, you can ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#0f172a;border-top:1px solid #334155;">
          <p style="color:#475569;font-size:11px;margin:0;line-height:1.4;">
            Vantage &middot; AI-first trading platform<br>
            This is an automated message. Please do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function getPasswordResetEmailHTML(token: string, email: string): string {
  const appUrl = getAppUrl();
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password — Vantage</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,&apos;Segoe UI&apos;,Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 32px 0;">
          <p style="font-size:28px;font-weight:800;color:#06b6d4;margin:0;letter-spacing:-0.5px;">Vantage</p>
          <p style="color:#94a3b8;font-size:13px;margin:4px 0 0;">AI-first trading, in your pocket</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="color:#f1f5f9;font-size:20px;margin:0 0 12px;">Reset your password</h2>
          <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 24px;">You requested a password reset. Click the button below to set a new password. This link expires in 1 hour:</p>
          <table cellpadding="0" cellspacing="0">
            <tr><td align="center" style="border-radius:8px;background:#06b6d4;">
              <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;">Reset Password</a>
            </td></tr>
          </table>
          <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;">
            If you didn&apos;t request a password reset, you can safely ignore this email — your password won&apos;t change.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#0f172a;border-top:1px solid #334155;">
          <p style="color:#475569;font-size:11px;margin:0;line-height:1.4;">
            Vantage &middot; AI-first trading platform<br>
            This is an automated message. Please do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
