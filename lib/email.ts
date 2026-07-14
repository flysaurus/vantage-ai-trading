// ─── Email Service ─────────────────────────────────────────────
// Priority: SMTP (Gmail) → Ethereal (dev fallback)
//
// SMTP (production): SMTP_HOST/PORT/USER/PASS
//   Gmail: host=smtp.gmail.com, port=587, secure=false
//   Uses Gmail app password (not regular password)
//
// Ethereal (dev): zero config, preview at ethereal.email

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@vantage.test';
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
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

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
  console.log('[email] ✅ Sent →', to, '(id:', info.messageId, ')');
  return { success: true, id: info.messageId, previewUrl };
}

// ─── Email Templates ───────────────────────────────────────────
// Vantage is magic-link-only (no password auth).
// Email templates for password reset / verification have been removed.
