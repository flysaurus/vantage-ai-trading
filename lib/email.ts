// ─── Email Service (Brevo) ─────────────────────────────────────
// Uses Brevo (Sendinblue) HTTP API for transactional emails.
// Free tier: 300 emails/day forever, no credit card, no domain DNS.
// Env vars: BREVO_API_KEY, FROM_EMAIL
//
// Setup: brevo.com → sign up → "SMTP & API" → API Keys → copy key
// Then verify your sender email in "Senders & IP" → Add Email

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@vantage.test';
const FROM_NAME = 'Vantage';

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!BREVO_API_KEY) {
    console.warn('[email] ⚠️ BREVO_API_KEY not set — skipping email send');
    return { success: false, error: 'BREVO_API_KEY not configured' };
  }

  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    const body = await resp.json();

    if (!resp.ok) {
      console.error('[email] ❌ Send failed:', body.message || body);
      throw new Error(body.message || 'Failed to send email');
    }

    console.log('[email] ✅ Sent to', to, '(id:', body.messageId, ')');
    return { success: true, id: body.messageId };
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
