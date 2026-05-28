// ─── GET+POST /api/auth/verify-email ────────────────────────────
// GET: redirect from email link → frontend page
// POST: JS-driven verification from /verify-email page
// Verifies email by token, sets email_verified=true on users table

import { NextRequest, NextResponse } from 'next/server';
import { authVerifyEmail } from '@/lib/auth-service';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const email = url.searchParams.get('email');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;

  if (!email || !token) {
    return NextResponse.redirect(`${appUrl}/verify-email`);
  }

  return NextResponse.redirect(
    `${appUrl}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim();
    const token = String(body.token || '').trim();

    console.log('👉 [verify-email API] POST for:', email);

    if (!email || !token) {
      return NextResponse.json({ error: 'Email and token required' }, { status: 400 });
    }

    const result = await authVerifyEmail(email, token);

    console.log('✅ [verify-email API] Success:', email);
    return NextResponse.json(result, { status: 200 });

  } catch (err: any) {
    const msg = String(err?.message || '');
    console.error('❌ [verify-email API] Error:', msg);

    if (msg.includes('already verified')) {
      return NextResponse.json({ error: msg, alreadyVerified: true }, { status: 200 });
    }
    if (msg.includes('expired')) {
      return NextResponse.json({ error: 'Verification link has expired. Please sign up again.' }, { status: 410 });
    }
    if (msg.includes('not found')) {
      return NextResponse.json({ error: 'Invalid verification link. Please sign up again.' }, { status: 400 });
    }
    if (msg.includes('Invalid')) {
      return NextResponse.json({ error: 'Invalid verification token. Please sign up again.' }, { status: 400 });
    }

    return NextResponse.json({ error: msg || 'Verification failed' }, { status: 500 });
  }
}
