// ─── POST /api/auth/resend-verification ────────────────────────
// Generates a new verification token for an existing unverified user.
// Sends email (best effort) and always returns the token in response.

import { NextRequest, NextResponse } from 'next/server';
import { regenerateVerificationToken } from '@/lib/auth-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();

    console.log('👉 [resend-verification] Request for:', email);

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const result = await regenerateVerificationToken(email);

    console.log('✅ [resend-verification] Token generated for:', email);
    return NextResponse.json(result, { status: 200 });

  } catch (err: any) {
    const msg = String(err.message || '');
    console.error('❌ [resend-verification] Error:', msg);

    if (msg.includes('No account found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }

    return NextResponse.json({ error: msg || 'Failed to resend' }, { status: 500 });
  }
}
