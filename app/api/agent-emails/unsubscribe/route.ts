/**
 * GET /api/agent-emails/unsubscribe
 *
 * One-click unsubscribe — no login required.
 * Token = HMAC-signed userId, verified server-side.
 * Sets agent_emails_enabled = false on the user's record.
 * Renders a simple confirmation HTML page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyUnsubscribeToken } from '@/lib/digest';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return new NextResponse(renderPage(false, 'Missing unsubscribe token.'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return new NextResponse(renderPage(false, 'Invalid or expired unsubscribe link.'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 400,
    });
  }

  const supabase = createServerClient() as any;

  const { error } = await supabase
    .from('users')
    .update({ agent_emails_enabled: false })
    .eq('id', userId);

  if (error) {
    console.error(`[unsubscribe] Failed to update user ${userId.slice(0, 8)}:`, error.message);
    return new NextResponse(renderPage(false, 'Something went wrong. Please try again or contact support.'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 500,
    });
  }

  console.log(`[unsubscribe] User ${userId.slice(0, 8)} unsubscribed from agent emails`);
  return new NextResponse(renderPage(true), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function renderPage(success: boolean, errorMessage?: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://vantage-ai-trading.vercel.app';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vantage — Email Preferences</title>
</head>
<body style="margin: 0; padding: 0; background: #0a0f1a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
  <div style="text-align: center; max-width: 400px; padding: 40px 24px;">
    <div style="font-size: 48px; margin-bottom: 16px;">${success ? '✅' : '❌'}</div>
    <div style="font-size: 20px; font-weight: 700; color: ${success ? '#22d3ee' : '#ef4444'}; margin-bottom: 12px;">
      ${success ? "You're unsubscribed" : 'Something went wrong'}
    </div>
    <div style="font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">
      ${success
        ? "You won't receive any more Portfolio Agent digest emails. You can re-enable them anytime in the Vantage app settings."
        : errorMessage || 'An unexpected error occurred.'}
    </div>
    <a href="${baseUrl}" style="display: inline-block; background: rgba(34,211,238,0.12); border: 1px solid rgba(34,211,238,0.25); border-radius: 8px; color: #22d3ee; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 24px;">
      Back to Vantage →
    </a>
  </div>
</body>
</html>`;
}
