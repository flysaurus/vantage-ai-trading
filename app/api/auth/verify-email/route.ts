// ─── GET+POST /api/auth/verify-email ────────────────────────────
// Verifies a user's email address using the token from the verification link.
// GET: direct link click (email clients) — redirects to frontend with same params
// POST: JS-based verification from /verify-email page

import { NextRequest, NextResponse } from 'next/server';
import { authVerifyEmail } from '@/lib/auth-service';

// GET handler — redirect to frontend verify-email page preserving params
// This ensures the link works even from plain email clients (no JS needed for redirect)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const email = url.searchParams.get('email');

  console.log('👉 [API-GET] Verify email redirect:', email);

  if (!email || !token) {
    // Redirect to frontend page without params — it will show error
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
    return NextResponse.redirect(`${appUrl}/verify-email`);
  }

  // Redirect to frontend page with the params intact
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const redirectUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  console.log('👉 [API-GET] Redirecting to:', redirectUrl);
  return NextResponse.redirect(redirectUrl);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const email = body.email;
  const token = body.token;

  console.log('👉 [API-POST] Verify email:', email, 'token length:', token?.length);

  if (!email || !token) {
    return NextResponse.json(
      { error: 'Email and token required' },
      { status: 400 }
    );
  }

  try {
    const result = await authVerifyEmail(email, token);
    console.log('✅ Email verified');
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('❌ Verify email error:', err.message);

    const msg = String(err.message || '');
    if (msg.includes('expired')) {
      return NextResponse.json({ error: msg }, { status: 410 });
    }
    if (msg.includes('not found') || msg.includes('Invalid')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg.includes('already verified')) {
      return NextResponse.json({ error: msg, alreadyVerified: true }, { status: 200 });
    }

    return NextResponse.json(
      { error: msg || 'Email verification failed' },
      { status: 500 }
    );
  }
}
