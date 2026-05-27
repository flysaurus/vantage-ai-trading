// ─── POST /api/auth/login ───────────────────────────────────────
// Authenticates a user with email + password.
// Creates a session record and sets an HTTP-only session cookie.
// Returns requires2FA flag if 2FA is enabled (session deferred).

import { NextRequest, NextResponse } from 'next/server';
import { authLogin } from '@/lib/auth-service';
import { createServerClient } from '@/lib/supabase';
import { hashSessionToken } from '@/lib/crypto';
import crypto from 'crypto';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { email, password } = await req.json().catch(() => ({}));

  console.log('👉 [API] Login request:', email);

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password required' },
      { status: 400 }
    );
  }

  try {
    const loginResult = await authLogin(email, password);

    // If 2FA required, return early — don't create session yet
    if (loginResult.requires2FA) {
      console.log('👉 [API] 2FA required for:', email);
      return NextResponse.json(
        {
          success: false,
          requires2FA: true,
          userId: loginResult.userId,
          message: 'Please complete 2FA verification',
        },
        { status: 200 }
      );
    }

    // Create session
    const supabase = createServerClient();
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionTokenHash = hashSessionToken(sessionToken);

    const { error: sessionError } = await (supabase as any)
      .from('sessions')
      .insert([{
        user_id: loginResult.userId,
        session_token_hash: sessionTokenHash,
        session_token_salt: crypto.randomBytes(16).toString('hex'),
        user_agent: req.headers.get('user-agent') || null,
        ip_address: req.headers.get('x-forwarded-for') || null,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      }]);

    if (sessionError) {
      console.error('❌ Session creation error:', sessionError);
      throw new Error('Failed to create session');
    }

    console.log('✅ Session created');

    // Set secure HTTP-only cookie
    const response = NextResponse.json(
      {
        success: true,
        userId: loginResult.userId,
        message: 'Login successful',
      },
      { status: 200 }
    );

    response.cookies.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (err: any) {
    console.error('❌ Login error:', err.message);

    const msg = String(err.message || '');
    if (msg.includes('Invalid email or password')) {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    if (msg.includes('verify your email')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    if (msg.includes('not active')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    return NextResponse.json(
      { error: msg || 'Login failed' },
      { status: 500 }
    );
  }
}
