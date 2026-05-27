// ─── POST /api/auth/signup ──────────────────────────────────────
// Creates a new user account with hashed password.
// Sends email verification link via Resend.

import { NextRequest, NextResponse } from 'next/server';
import { authSignup } from '@/lib/auth-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { email, password, displayName } = await req.json().catch(() => ({}));

  console.log('👉 [API] Signup request:', email);

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password required' },
      { status: 400 }
    );
  }

  try {
    const result = await authSignup(email, password, displayName);
    console.log('✅ Signup successful');
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('❌ Signup error:', err.message);

    // Map known errors to appropriate status codes
    const msg = String(err.message || '');
    if (msg.includes('already registered') || msg.includes('already exists')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (msg.includes('Password must be')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json(
      { error: msg || 'Signup failed' },
      { status: 500 }
    );
  }
}
