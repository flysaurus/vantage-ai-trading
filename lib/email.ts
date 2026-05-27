// ─── Email Service (Mailgun) ────────────────────────────────────
// Uses Mailgun HTTP API for transactional emails (verification, password reset).
// Free tier: 100 emails/day on sandbox domain. No npm SDK needed.
//
// Env vars: MAILGUN_API_KEY, MAILGUN_DOMAIN, FROM_EMAIL

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || '';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || '';
const FROM_EMAIL = process.env.FROM_EMAIL || `noreply@${MAILGUN_DOMAIN}`;

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.warn('[email] ⚠️ Mailgun not configured — skipping email send');
    return { success: false, error: 'MAILGUN_API_KEY or MAILGUN_DOMAIN not set' };
  }

  const formData = new URLSearchParams();
  formData.append('from', FROM_EMAIL);
  formData.append('to', to);
  formData.append('subject', subject);
  formData.append('html', html);

  try {
    const resp = await fetch(
      `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      }
    );

    const body = await resp.json();

    if (!resp.ok) {
      console.error('[email] ❌ Send failed:', body.message || body);
      throw new Error(body.message || 'Failed to send email');
    }

    console.log('[email] ✅ Sent to', to, '(id:', body.id, ')');
    return { success: true, id: body.id };
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
