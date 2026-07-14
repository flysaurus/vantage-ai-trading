// ─── POST /api/auth/verify-login-otp — Verify OTP for login ──
// Server-side wrapper around Supabase verifyOtp.
// Creates a session and returns the access token for mobile apps.
//
// POST body: { email, code }
// Response:  { success: true, session: { access_token, refresh_token, expires_at, user } }
// Errors:    400 invalid/expired/wrong code, 429 rate limited, 500 internal

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// In-memory rate limiter — max 5 attempts per 60s per email
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  let email: string;
  let code: string;

  try {
    const body = await req.json();
    email = (body.email || '').trim().toLowerCase();
    code = String(body.code || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Code must be 6 digits' }, { status: 400 });
  }

  // Rate limit verification attempts
  const now = Date.now();
  const bucket = attempts.get(email);
  if (bucket) {
    if (bucket.resetAt < now) {
      // Reset expired window
      attempts.set(email, { count: 1, resetAt: now + WINDOW_MS });
    } else if (bucket.count >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: 'Too many attempts. Please request a new code.' },
        { status: 429 },
      );
    } else {
      bucket.count++;
    }
  } else {
    attempts.set(email, { count: 1, resetAt: now + WINDOW_MS });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  });

  if (error) {
    console.error('[verify-login-otp] Error:', error.message);

    if (error.message?.includes('expired')) {
      return NextResponse.json(
        { error: 'This code has expired. Request a new one.', code: 'EXPIRED' },
        { status: 410 },
      );
    }

    if (error.message?.includes('invalid') || error.message?.includes('not found')) {
      return NextResponse.json(
        { error: 'Invalid or incorrect code. Check your email and try again.', code: 'INVALID' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: error.message, code: 'VERIFY_FAILED' },
      { status: 400 },
    );
  }

  if (!data.session) {
    return NextResponse.json(
      { error: 'Verification failed. No session created.', code: 'NO_SESSION' },
      { status: 500 },
    );
  }

  // Return session data for mobile apps to store and use as Bearer token
  return NextResponse.json({
    success: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.session.user.id,
        email: data.session.user.email,
      },
    },
  });
}
