// ─── Invite Emails ────────────────────────────────────────────
// Server-only: only imported by API routes, never by client code.
// Uses lib/email.ts (nodemailer → Gmail SMTP, same as Supabase Auth).

import { sendEmail } from './email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

function buildInviteSubject(): string {
  return '🎯 You\'re invited to Vantage';
}

function buildInviteHtml(inviteToken: string, invitedEmail: string): string {
  const signupUrl = `${APP_URL}/create-account?invite=${inviteToken}`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #06b6d4, #3b82f6); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; font-size: 28px; margin: 0 0 8px 0;">🎯 Vantage</h1>
        <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 0;">Your AI investing co-pilot</p>
      </div>
      <div style="background: #1e293b; border-radius: 0 0 12px 12px; padding: 24px; color: #cbd5e1;">
        <p style="font-size: 16px; margin: 0 0 16px 0;">You've been invited to join <strong style="color: #f8fafc;">Vantage</strong> — an AI-powered investing platform that matches your personal investing style.</p>
        <p style="font-size: 14px; margin: 0 0 24px 0;">Take a 2-minute quiz to discover your investor personality, then get stock picks, portfolio analysis, and trade recommendations tailored to <em>your</em> strategy.</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${signupUrl}" style="display: inline-block; background: #06b6d4; color: #0a0f1e; padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 16px; text-decoration: none;">Accept Invite →</a>
        </div>
        <p style="font-size: 13px; color: #94a3b8; margin: 24px 0 8px 0; text-align: center;">
          This invite was sent to <strong>${invitedEmail}</strong>.
        </p>
        <p style="font-size: 12px; color: #94a3b8; margin: 0; text-align: center;">
          Link expires in 30 days. If you didn't expect this, you can ignore it.
        </p>
      </div>
    </div>
  `;
}

/**
 * Send an invite email via SMTP (lib/email.ts → nodemailer → Gmail).
 * Only called from API routes. Never imported by client code.
 */
export async function sendInviteEmail(
  email: string,
  inviteToken: string,
): Promise<boolean> {
  if (!email || !email.includes('@')) {
    console.error('[invite-email] Invalid invite email, skipping');
    return false;
  }

  try {
    await sendEmail({
      to: email,
      subject: buildInviteSubject(),
      html: buildInviteHtml(inviteToken, email),
    });
    console.log(`[invite-email] Sent invite to ${email}`);
    return true;
  } catch (err: any) {
    console.error(`[invite-email] Failed for ${email}:`, err.message);
    return false;
  }
}
