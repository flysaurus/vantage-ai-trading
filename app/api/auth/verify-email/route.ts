// ─── GET+POST /api/auth/verify-email ────────────────────────────
// GET: redirect from email link → frontend page
// POST: JS-driven verification from /verify-email page
// Verifies email by token, sets email_verified=true on users table

import { NextRequest, NextResponse } from 'next/server';
import { authVerifyEmail } from '@/lib/auth-service';

const TS = () => new Date().toISOString();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const email = url.searchParams.get('email');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;

  console.log(`[${TS()}] 📧 GET /verify-email — email=${email} token=${token?.substring(0,8)}...`);

  if (!email || !token) {
    console.log(`[${TS()}] ❌ GET redirect missing params`);
    return NextResponse.redirect(`${appUrl}/verify-email`);
  }

  console.log(`[${TS()}] 🔀 GET redirecting to /verify-email?token=...&email=${email}`);
  return NextResponse.redirect(
    `${appUrl}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let email = '';
  const startTs = TS();
  try {
    const body = await req.json().catch(() => ({}));
    email = String(body.email || '').trim();
    const token = String(body.token || '').trim();

    console.log(`[${TS()}] 👉 POST verify-email — email="${email}" token_len=${token.length} token_first8=${token.substring(0,8)}`);

    if (!email || !token) {
      console.log(`[${TS()}] ❌ POST missing params`);
      return NextResponse.json({ error: 'Email and token required', debug: { step: 'validate_params', status: 'fail' } }, { status: 400 });
    }

    console.log(`[${TS()}] 🔍 Calling authVerifyEmail("${email}", "${token.substring(0,8)}...")`);
    const result = await authVerifyEmail(email, token);

    console.log(`[${TS()}] ✅ POST verify-email SUCCESS — email="${email}" total_ms=${Date.now() - new Date(startTs).getTime()}`);
    return NextResponse.json({ ...result, verifiedEmail: email, debug: { step: 'complete', status: 'ok', totalMs: Date.now() - new Date(startTs).getTime() } }, { status: 200 });

  } catch (err: any) {
    const msg = String(err?.message || '');
    console.error(`[${TS()}] ❌ POST verify-email ERROR — email="${email}" msg="${msg}"`);

    if (msg.includes('already verified')) {
      return NextResponse.json({ error: msg, alreadyVerified: true, verifiedEmail: email, debug: { step: 'already_verified', status: 'ok' } }, { status: 200 });
    }
    if (msg.includes('expired')) {
      return NextResponse.json({ error: 'Verification link has expired. Please sign up again.', verifiedEmail: email, debug: { step: 'token_expired', status: 'fail' } }, { status: 410 });
    }
    if (msg.includes('not found')) {
      return NextResponse.json({ error: 'Invalid verification link. Please sign up again.', verifiedEmail: email, debug: { step: 'token_not_found', status: 'fail' } }, { status: 400 });
    }
    if (msg.includes('Invalid')) {
      return NextResponse.json({ error: 'Invalid verification token. Please sign up again.', verifiedEmail: email, debug: { step: 'token_invalid', status: 'fail' } }, { status: 400 });
    }

    return NextResponse.json({ error: msg || 'Verification failed', verifiedEmail: email, debug: { step: 'unknown_error', status: 'fail', raw: msg } }, { status: 500 });
  }
}
