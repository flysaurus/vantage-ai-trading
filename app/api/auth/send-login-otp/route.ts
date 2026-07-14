// ─── POST /api/auth/send-login-otp — Send OTP for login ──
// Server-side wrapper around Supabase signInWithOtp.
// For mobile apps that call API routes instead of the Supabase SDK directly.
//
// POST body: { email }
// Response:  { success: true }
// Errors:    400 invalid email, 429 rate limited, 500 internal

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// In-memory rate limiter — max 1 request per 15s per email
const cooldown = new Map<string, number>();
const COOLDOWN_MS = 15_000;

export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = await req.json();
    email = (body.email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  // Rate limit
  const last = cooldown.get(email);
  if (last && Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'Please wait before requesting another code' },
      { status: 429 },
    );
  }
  cooldown.set(email, Date.now());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 },
    );
  }

  // Use anon key client — signInWithOtp is a public operation
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false, // login only, no auto-signup
    },
  });

  if (error) {
    console.error('[send-login-otp] Error:', error.message);

    if (error.message?.includes('rate') || error.status === 429) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to send code. Please try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
