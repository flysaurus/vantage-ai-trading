// ─── POST /api/auth/reset-password ──────────────────────────────
// Resets a user's password using the token from the reset email.

import { NextRequest, NextResponse } from 'next/server';
import { authResetPassword } from '@/lib/auth-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { email, token, newPassword } = await req.json().catch(() => ({}));

  console.log('👉 [API] Reset password:', email);

  if (!email || !token || !newPassword) {
    return NextResponse.json(
      { error: 'Email, token, and new password required' },
      { status: 400 }
    );
  }

  try {
    const result = await authResetPassword(email, token, newPassword);
    console.log('✅ Password reset');
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('❌ Reset password error:', err.message);

    const msg = String(err.message || '');
    if (msg.includes('expired')) {
      return NextResponse.json({ error: msg }, { status: 410 });
    }
    if (msg.includes('already been used')) {
      return NextResponse.json({ error: msg }, { status: 410 });
    }
    if (msg.includes('not found') || msg.includes('Invalid')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json(
      { error: msg || 'Password reset failed' },
      { status: 500 }
    );
  }
}
