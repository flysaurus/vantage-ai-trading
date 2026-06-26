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
// Vantage is magic-link-only (no password auth).
// Email templates for password reset / verification have been removed.
