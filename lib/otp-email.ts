// ─── OTP Verification Email ──────────────────────────────────
// Server-only: only imported by API routes, never by client code.
// Uses lib/email.ts (nodemailer → Gmail SMTP, same as Supabase Auth).

import { sendEmail } from './email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

function buildOtpSubject(): string {
  return '[Vantage] Verify your email';
}

function buildOtpHtml(email: string, code: string): string {
  const verifyUrl = `${APP_URL}/verify-email?email=${encodeURIComponent(email)}&code=${code}`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #06b6d4, #3b82f6); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; font-size: 28px; margin: 0 0 8px 0;">Vantage</h1>
        <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0;">Your AI investing co-pilot</p>
      </div>
      <div style="background: #1e293b; border-radius: 0 0 12px 12px; padding: 24px; color: #cbd5e1;">
        <p style="font-size: 18px; margin: 0 0 16px 0; color: #f8fafc;">
          Verify your email to complete signup
        </p>
        <p style="font-size: 14px; margin: 0 0 24px 0; line-height: 1.6;">
          Click the button below to verify your email address and activate your Vantage account.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background: #06b6d4; color: #0a0f1e; padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 16px; text-decoration: none;">Verify Email →</a>
        </div>
        <p style="font-size: 13px; color: #e2e8f0; margin: 16px 0 4px 0; text-align: center;">
          Or enter this code manually:
        </p>
        <p style="font-size: 28px; font-family: 'SF Mono', 'Fira Code', monospace; letter-spacing: 8px; color: #f8fafc; margin: 8px 0 24px 0; text-align: center; font-weight: 700;">
          ${code}
        </p>
        <p style="font-size: 12px; color: #e2e8f0; margin: 24px 0 4px 0; text-align: center;">
          This code expires in 15 minutes.
        </p>
        <p style="font-size: 12px; color: #e2e8f0; margin: 4px 0 0 0; text-align: center;">
          If you didn't create this account, you can ignore this email.
        </p>
      </div>
    </div>
  `;
}

export async function sendOtpEmail(
  email: string,
  code: string,
): Promise<boolean> {
  if (!email || !email.includes('@')) {
    console.error('[otp-email] Invalid email, skipping');
    return false;
  }

  try {
    await sendEmail({
      to: email,
      subject: buildOtpSubject(),
      html: buildOtpHtml(email, code),
    });
    console.log(`[otp-email] Sent verification code to ${email}`);
    return true;
  } catch (err: any) {
    console.error(`[otp-email] Failed for ${email}:`, err.message);
    return false;
  }
}
