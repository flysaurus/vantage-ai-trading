// ─── Email Service (Ethereal + Nodemailer) ─────────────────────
// Development: Ethereal fake SMTP (zero config, emails visible at ethereal.email)
// Production:  Set SMTP_HOST/PORT/USER/PASS env vars for any real SMTP provider.
//
// Zero signups. Zero domain verification. Just works.

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vantage.test';
const FROM_NAME = 'Vantage';

let _transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (!_transporter) {
    const smtpHost = process.env.SMTP_HOST;

    if (smtpHost) {
      // Production: real SMTP
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
      // Development: Ethereal fake SMTP
      const testAccount = await nodemailer.createTestAccount();
      console.log('[email] 🔧 Using Ethereal test account:', testAccount.user);
      _transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }
  }
  return _transporter;
}

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    });

    // Ethereal provides a preview URL to view the email
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log('[email] ✅ Preview:', previewUrl);
    }
    console.log('[email] ✅ Sent to', to, '(id:', info.messageId, ')');
    return { success: true, id: info.messageId, previewUrl };
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
