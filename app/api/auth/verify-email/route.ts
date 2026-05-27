// ─── POST /api/auth/verify-email ────────────────────────────────
// Verifies a user's email address using the token from the verification link.

import { NextRequest, NextResponse } from 'next/server';
import { authVerifyEmail } from '@/lib/auth-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { email, token } = await req.json().catch(() => ({}));

  console.log('👉 [API] Verify email:', email);

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
