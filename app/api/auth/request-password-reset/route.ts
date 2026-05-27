// ─── POST /api/auth/request-password-reset ──────────────────────
// Sends a password reset email if the account exists.
// Always returns success to prevent email enumeration.

import { NextRequest, NextResponse } from 'next/server';
import { authRequestPasswordReset } from '@/lib/auth-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { email } = await req.json().catch(() => ({}));

  console.log('👉 [API] Password reset request:', email);

  if (!email) {
    return NextResponse.json(
      { error: 'Email required' },
      { status: 400 }
    );
  }

  try {
    const result = await authRequestPasswordReset(email);
    console.log('✅ Reset request processed');
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('❌ Reset request error:', err.message);

    // Return generic message to avoid leaking user existence
    return NextResponse.json(
      { success: true, message: 'If this email exists, a password reset link has been sent' },
      { status: 200 }
    );
  }
}
