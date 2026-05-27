// ─── Email Service (SendGrid) ───────────────────────────────────
// Uses SendGrid Mail Send API v3 for transactional emails.
// Free tier: 100 emails/day forever, no credit card, no IP whitelist.
// Env vars: SENDGRID_API_KEY, FROM_EMAIL
//
// Setup:
// 1. sign up at sendgrid.com → free tier
// 2. Settings → API Keys → Create API Key → "Restricted Access" → "Mail Send"
// 3. Settings → Sender Authentication → "Verify a Single Sender" → verify your email

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vantage.test';
const FROM_NAME = 'Vantage';

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!SENDGRID_API_KEY) {
    console.warn('[email] ⚠️ SENDGRID_API_KEY not set — skipping email send');
    return { success: false, error: 'SENDGRID_API_KEY not configured' };
  }

  try {
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
      console.error('[email] ❌ Send failed:', msg);
      throw new Error(msg);
    }

    console.log('[email] ✅ Sent to', to);
    return { success: true };
  } catch (err: any) {
    console.error('[email] ❌ Unexpected error:', err.message);
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
