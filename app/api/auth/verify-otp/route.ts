// ─── POST /api/auth/verify-otp — Validate OTP Code ───────
// Public. Body: { email, code }
// Validates 6-digit code, handles attempts, marks email verified.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanCode = String(code || '').trim();

    if (!/^\d{6}$/.test(cleanCode)) {
      return NextResponse.json({ error: 'Code must be 6 digits', code: 'INVALID_FORMAT' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const sb = supabase as any;

    // Find user with OTP fields
    const { data: userRows, error: userErr } = await sb
      .from('users')
      .select('id, email, email_verified, otp_code, otp_expires_at, wrong_otp_attempts')
      .eq('email', normalizedEmail)
      .limit(1);

    if (userErr || !userRows?.length) {
      return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });
    }

    const user = userRows[0];

    // Already verified
    if (user.email_verified) {
      return NextResponse.json({ success: true, already_verified: true });
    }

    // No OTP requested yet
    if (!user.otp_code) {
      return NextResponse.json({ error: 'No verification code has been sent. Request one first.', code: 'NO_OTP' }, { status: 400 });
    }

    // Check expiry
    if (user.otp_expires_at && new Date(user.otp_expires_at) < new Date()) {
      return NextResponse.json({ error: 'This code has expired. Request a new one.', code: 'EXPIRED' }, { status: 410 });
    }

    // Check attempts (locked out after 5)
    if (user.wrong_otp_attempts >= 5) {
      return NextResponse.json({ error: 'Too many incorrect attempts. Please request a new code.', code: 'LOCKED_OUT' }, { status: 429 });
    }

    // Check code match
    if (cleanCode !== user.otp_code) {
      const newAttempts = (user.wrong_otp_attempts || 0) + 1;
      const { error: updateErr } = await sb
        .from('users')
        .update({ wrong_otp_attempts: newAttempts })
        .eq('id', user.id);

      if (updateErr) {
        console.error('[verify-otp] Update error:', updateErr.message);
      }

      const remaining = 5 - newAttempts;

      if (newAttempts >= 5) {
        return NextResponse.json({
          error: 'Too many incorrect attempts. Please request a new code.',
          code: 'LOCKED_OUT',
        }, { status: 429 });
      }

      return NextResponse.json({
        error: 'That code is incorrect. Check your email and try again.',
        code: 'WRONG_CODE',
        attempts_remaining: remaining,
      }, { status: 400 });
    }

    // ✅ Success — mark verified, clear OTP
    const { error: verifyErr } = await sb
      .from('users')
      .update({
        email_verified: true,
        otp_code: null,
        otp_expires_at: null,
        wrong_otp_attempts: 0,
      })
      .eq('id', user.id);

    if (verifyErr) {
      console.error('[verify-otp] Verify update error:', verifyErr.message);
      return NextResponse.json({ error: 'Failed to mark as verified' }, { status: 500 });
    }

    console.log('[verify-otp] ✅ Verified email for', normalizedEmail);

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
    });
  } catch (err: any) {
    console.error('[verify-otp] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
