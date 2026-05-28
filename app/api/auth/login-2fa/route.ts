// ─── POST /api/auth/login-2fa ──────────────────────────────────
// Creates session after successful 2FA verification.
// Called by login page after /api/auth/2fa/verify succeeds.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { hashSessionToken } from '@/lib/crypto';
import crypto from 'crypto';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await req.json().catch(() => ({}));

  if (!userId) {
    return NextResponse.json(
      { error: 'User ID required' },
      { status: 400 }
    );
  }

  try {
    const supabase = createServerClient();

    // Verify user exists and has 2FA enabled
    const { data: user, error: userError } = await (supabase as any)
      .from('users')
      .select('id, two_factor_enabled, status, email_verified')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (!user.email_verified) {
      return NextResponse.json(
        { error: 'Please verify your email before logging in' },
        { status: 403 }
      );
    }

    if (user.status !== 'active') {
      return NextResponse.json(
        { error: 'Your account is not active' },
        { status: 403 }
      );
    }

    if (!user.two_factor_enabled) {
      return NextResponse.json(
        { error: '2FA not enabled for this account' },
        { status: 400 }
      );
    }

    // Create session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionTokenHash = hashSessionToken(sessionToken);

    const { error: sessionError } = await (supabase as any)
      .from('user_sessions')
      .insert([{
        user_id: userId,
        session_token_hash: sessionTokenHash,
        session_token_salt: crypto.randomBytes(16).toString('hex'),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }]);

    if (sessionError) {
      console.error('❌ Session creation error:', sessionError);
      throw new Error(`Failed to create session: ${sessionError.message}`);
    }

    // Update last_login
    await (supabase as any)
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', userId);

    console.log('✅ [login-2fa] Session created for:', userId);

    const response = NextResponse.json(
      { success: true, message: 'Login successful' },
      { status: 200 }
    );

    response.cookies.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err: any) {
    console.error('❌ [login-2fa] Error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
