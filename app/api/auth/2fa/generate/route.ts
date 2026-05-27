// ─── POST /api/auth/2fa/generate ────────────────────────────────
// Generates a TOTP secret + QR code for the user to scan.
// Does NOT store anything — enable2FA does the persistence.

import { NextRequest, NextResponse } from 'next/server';
import { generate2FASecret } from '@/lib/auth-service';

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));

  console.log('👉 [API] Generate 2FA secret:', email);

  if (!email) {
    return NextResponse.json(
      { error: 'Email required' },
      { status: 400 }
    );
  }

  try {
    const result = await generate2FASecret(email);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('❌ Generate 2FA error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to generate 2FA secret' },
      { status: 500 }
    );
  }
}
