// ─── POST /api/auth/signup — Server-side signup with invite gate ──
// Replaces client-side supabase.auth.signUp().
// Enforces hard invite-only gate BEFORE user creation.
//
// Flow:
//  1. Validate invite token (must be pending, unexpired, matching email)
//  2. If no valid invite → 403, caller shows waitlist UI
//  3. If valid → create user via Supabase Admin API (service role)
//  4. Mark invite as accepted
//  5. Return success → client sends OTP magic link for verification
//
// This cannot be bypassed by calling Supabase Auth directly —
// the Admin API is server-side with the service role key.
//
// POST body: { email, password, firstName, lastName, inviteToken, style, risk }
// Responses:
//   200 { success, userId, email, needsVerification: true }
//   403 { error, code: 'NO_INVITE' | 'INVITE_EXPIRED' | 'INVITE_USED' }
//   409 { error, code: 'EMAIL_EXISTS' }

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOtpEmail } from '@/lib/otp-email';

// Service role client — bypasses RLS, full admin access
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  let body: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    inviteToken?: string;
    style?: string;
    risk?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { email, password, firstName, lastName, inviteToken, style, risk } = body;

  // ── Validation ──────────────────────────────────────────
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // ── 1. Validate invite token (hard gate) ───────────────
  const supabase = getServiceClient();
  const sb = supabase as any;

  if (!inviteToken) {
    return NextResponse.json(
      { error: 'An invite is required to join Vantage', code: 'NO_INVITE' },
      { status: 403 },
    );
  }

  try {
    // Check if a valid, pending, unexpired invite exists for this token+email
    const { data: invite, error: inviteErr } = await sb
      .from('invites')
      .select('id, email, status, expires_at')
      .eq('invite_token', inviteToken)
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (inviteErr && !inviteErr.message?.includes('does not exist')) {
      console.error('[auth/signup] Invite lookup error:', inviteErr.message);
      return NextResponse.json(
        { error: 'Unable to verify invite. Please try again.', code: 'INVITE_CHECK_FAILED' },
        { status: 500 },
      );
    }

    if (!invite) {
      return NextResponse.json(
        { error: 'No valid invite found for this email. Request an invite from an admin.', code: 'NO_INVITE' },
        { status: 403 },
      );
    }

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'This invite has already been used.', code: 'INVITE_USED' },
        { status: 403 },
      );
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This invite has expired. Request a new one from an admin.', code: 'INVITE_EXPIRED' },
        { status: 403 },
      );
    }

    // ── 2. Check if email already exists ──────────────────
    try {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const exists = existingUsers?.users?.some(
        (u: any) => u.email?.toLowerCase() === normalizedEmail,
      );
      if (exists) {
        return NextResponse.json(
          { error: 'An account with this email already exists', code: 'EMAIL_EXISTS' },
          { status: 409 },
        );
      }
    } catch {
      // listUsers might fail on free-tier Supabase — fall through
    }

    // ── 3. Create user via Admin API ──────────────────────
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true, // Auth system sees as confirmed; our users.email_verified tracks app-level OTP
      user_metadata: {
        first_name: firstName || '',
        last_name: lastName || '',
        investor_style: style || '',
        risk_tolerance: risk || '',
        invite_token: inviteToken,
      },
    });

    if (createErr) {
      console.error('[auth/signup] User creation failed:', createErr.message);
      // Check for duplicate email
      if (createErr.message?.includes('already') || createErr.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'An account with this email already exists', code: 'EMAIL_EXISTS' },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: createErr.message, code: 'CREATE_FAILED' },
        { status: 500 },
      );
    }

    if (!newUser?.user) {
      return NextResponse.json(
        { error: 'User creation failed unexpectedly', code: 'CREATE_FAILED' },
        { status: 500 },
      );
    }

    const userId = newUser.user.id;

    // ── 4. Mark invite as accepted ────────────────────────
    const now = new Date().toISOString();
    const { error: acceptErr } = await sb
      .from('invites')
      .update({ status: 'accepted', accepted_at: now })
      .eq('id', invite.id);

    if (acceptErr && !acceptErr.message?.includes('does not exist')) {
      console.warn('[auth/signup] Failed to mark invite accepted:', acceptErr.message);
    }

    // ── 5. Create users row (same as /api/user/setup) ─────
    const { error: userRowErr } = await sb
      .from('users')
      .upsert(
        {
          id: userId,
          email: normalizedEmail,
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          investor_style: style || undefined,
          risk_tolerance: risk || undefined,
          investor_style_onboarded: true,
          tier: 'demo',
          first_open: now,
          last_login_at: now,
        },
        { onConflict: 'id', ignoreDuplicates: false },
      );

    if (userRowErr) {
      console.warn('[auth/signup] User row creation failed:', userRowErr.message);
      // Non-fatal — user exists in auth, row can be recovered
    }

    // ── 6. Also insert into access_requests as approved (auto-approve path) ──
    try {
      await sb.from('access_requests').upsert(
        {
          email: normalizedEmail,
          name: [firstName, lastName].filter(Boolean).join(' ') || null,
          status: 'approved',
          auto_approve: true,
          reviewed_by: 'system',
          reviewed_at: now,
          requested_at: now,
        },
        { onConflict: 'email', ignoreDuplicates: false },
      );
    } catch {
      // Non-fatal
    }

    console.log('[auth/signup] ✅ Created user', userId, 'with invite', inviteToken.slice(0, 12) + '...');

    // ── 7. Generate OTP and send verification email ─────
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    try {
      await sb.from('users').update({
        otp_code: otpCode,
        otp_expires_at: otpExpiresAt,
        wrong_otp_attempts: 0,
      }).eq('id', userId);
    } catch (otpErr: any) {
      console.warn('[auth/signup] Failed to store OTP:', otpErr.message);
    }

    // Fire-and-forget email (don't block response on SMTP)
    sendOtpEmail(normalizedEmail, otpCode).catch((e: any) =>
      console.error('[auth/signup] OTP email failed:', e.message),
    );

    return NextResponse.json({
      success: true,
      userId,
      email: normalizedEmail,
      needsVerification: true,
    });
  } catch (err: any) {
    console.error('[auth/signup] Unexpected error:', err.message);
    return NextResponse.json(
      { error: 'Signup failed. Please try again.', code: 'UNKNOWN' },
      { status: 500 },
    );
  }
}
