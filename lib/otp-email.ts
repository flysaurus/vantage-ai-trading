// ─── OTP Verification Email ──────────────────────────────────
// Server-only: imported by API routes, never by client code.
// Uses Gmail SMTP via lib/email.ts (SendGrid → SMTP fallback chain).

import { sendEmail } from './email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

function buildOtpSubject(): string {
  return '[Vantage] Verify your email';
}

function buildOtpHtml(email: string, code: string): string {
  const verifyUrl = `${APP_URL}/verify-otp?email=${encodeURIComponent(email)}&otp=${code}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0b1120;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#06b6d4,#3b82f6);padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="color:#fff;font-size:28px;margin:0 0 8px 0;">Vantage</h1>
      <p style="color:rgba(255,255,255,0.9);font-size:16px;margin:0;">Your AI investing co-pilot</p>
    </div>

    <!-- Body -->
    <div style="background:#1a2235;border-radius:0 0 12px 12px;padding:24px;color:#cbd5e1;">

      <!-- Clickable verify button -->
      <p style="font-size:18px;margin:0 0 16px 0;color:#f8fafc;font-weight:600;">
        Verify your email to complete signup
      </p>
      <p style="font-size:14px;margin:0 0 24px 0;line-height:1.6;color:#e2e8f0;">
        Click the button below to verify your email address and activate your Vantage account.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${verifyUrl}" style="display:inline-block;background:#06b6d4;color:#0a0f1e;padding:14px 36px;border-radius:8px;font-weight:700;font-size:16px;text-decoration:none;">
          Verify Email →
        </a>
      </div>

      <!-- Manual code fallback -->
      <p style="font-size:13px;color:#e2e8f0;margin:24px 0 4px 0;text-align:center;">
        Or enter this code manually on the verification page:
      </p>
      <p style="font-size:32px;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;letter-spacing:10px;color:#f8fafc;margin:8px 0 24px 0;text-align:center;font-weight:700;">
        ${code}
      </p>

      <!-- Direct URL fallback (visible even if button HTML is stripped) -->
      <p style="font-size:12px;color:#94a3b8;margin:0 0 24px 0;text-align:center;word-break:break-all;">
        Or copy this link into your browser:<br>
        <a href="${verifyUrl}" style="color:#06b6d4;text-decoration:underline;">${verifyUrl}</a>
      </p>

      <!-- Expiry notice -->
      <p style="font-size:12px;color:#e2e8f0;margin:24px 0 4px 0;text-align:center;font-weight:600;">
        ⏳ This code expires in 15 minutes.
      </p>
      <p style="font-size:12px;color:#e2e8f0;margin:4px 0 0 0;text-align:center;">
        If you didn't create this account, you can ignore this email.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0 0;">
      <p style="font-size:11px;color:#e2e8f0;margin:0;line-height:1.6;">
        Vantage &middot; AI-Powered Investing<br>
        This is a transactional email for account verification.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendOtpEmail(
  email: string,
  code: string,
): Promise<boolean> {
  if (!email || !email.includes('@')) {
    console.error('[otp-email] Invalid email, skipping');
    return false;
  }

  const subject = buildOtpSubject();
  const html = buildOtpHtml(email, code);

  try {
    await sendEmail({ to: email, subject, html });
    console.log(`[otp-email] ✅ → ${email}`);
    return true;
  } catch (err: any) {
    console.error(`[otp-email] Failed for ${email}:`, err.message);
    console.log(`[otp-email] code=${code}`);
    return false;
  }
}
