// ─── POST /api/auth/signup ──────────────────────────────────────
// Creates a new user account with hashed password.
// Sends email verification link via Resend.

import { NextRequest, NextResponse } from 'next/server';
import { authSignup } from '@/lib/auth-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const email = body.email;
  const password = body.password;
  const displayName = body.displayName;

  console.log('👉 [API] Signup request:', email, '| hasPassword:', !!password, '| hasName:', !!displayName);

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password required' },
      { status: 400 }
    );
  }

  // Validate display name
  const name = (displayName || '').trim();
  if (!name) {
    console.log('❌ [API] Signup rejected: no display name');
    return NextResponse.json(
      { error: 'Full name is required.' },
      { status: 400 }
    );
  }
  if (name.length < 2) {
    return NextResponse.json(
      { error: 'Name must be at least 2 characters.' },
      { status: 400 }
    );
  }
  if (name.length > 50) {
    return NextResponse.json(
      { error: 'Name must be under 50 characters.' },
      { status: 400 }
    );
  }
  if (!/^[a-zA-Z]/.test(name)) {
    return NextResponse.json(
      { error: 'Name must start with a letter.' },
      { status: 400 }
    );
  }
  if (!/^[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF][a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s\-'.]*$/.test(name)) {
    return NextResponse.json(
      { error: 'Name can only contain letters, spaces, hyphens, and apostrophes.' },
      { status: 400 }
    );
  }

  try {
    const result = await authSignup(email, password, name);
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
