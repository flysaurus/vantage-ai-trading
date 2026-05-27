// ─── POST /api/auth/2fa/verify ──────────────────────────────────
// Verifies a 2FA code (TOTP or backup) for a given user.
// Used during login when 2FA is required — the login route returns
// { requires2FA: true, userId } and the client calls this to complete.
// NOTE: This only verifies the code — session creation is handled
// separately via /api/auth/login once 2FA is confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { verify2FACode, verifyBackupCode } from '@/lib/auth-service';

export async function POST(req: NextRequest) {
  const { userId, code } = await req.json().catch(() => ({}));

  console.log('👉 [API] Verify 2FA code:', userId);

  if (!userId || !code) {
    return NextResponse.json(
      { error: 'userId and code required' },
      { status: 400 }
    );
  }

  try {
    let valid = await verify2FACode(userId, code);
    if (!valid) {
      valid = await verifyBackupCode(userId, code);
    }

    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid 2FA code' },
        { status: 400 }
      );
    }

    console.log('✅ 2FA code verified');

    return NextResponse.json({
      success: true,
      message: '2FA code verified',
    }, { status: 200 });
  } catch (err: any) {
    console.error('❌ Verify 2FA error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to verify 2FA code' },
      { status: 500 }
    );
  }
}
