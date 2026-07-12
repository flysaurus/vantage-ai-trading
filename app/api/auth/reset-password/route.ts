// ─── POST /api/auth/reset-password — Set new password via reset token ──
// Public endpoint — no auth required (the reset token IS the auth).
//
// Flow:
//  1. Validate reset token (must exist, be unused, unexpired)
//  2. Update the user's password via Supabase Admin API
//  3. Mark the reset token as used
//  4. Return success
//
// POST body: { token, newPassword }

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
  let body: { token?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { token, newPassword } = body;

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Reset token is required' }, { status: 400 });
  }

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();
  const sb = supabase as any;

  try {
    // 1. Look up the reset token
    const { data: resetRecord, error: lookupErr } = await sb
      .from('password_resets')
      .select('id, user_id, email, reset_token, expires_at, used_at')
      .eq('reset_token', token)
      .maybeSingle();

    if (lookupErr || !resetRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link.' },
        { status: 400 },
      );
    }

    if (resetRecord.used_at) {
      return NextResponse.json(
        { error: 'This reset link has already been used.' },
        { status: 400 },
      );
    }

    if (new Date(resetRecord.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'This reset link has expired. Request a new one from an admin.' },
        { status: 400 },
      );
    }

    // 2. Update the user's password via Admin API
    const { error: updateErr } = await supabase.auth.admin.updateUserById(
      resetRecord.user_id,
      { password: newPassword },
    );

    if (updateErr) {
      console.error('[reset-password] Password update failed:', updateErr.message);
      return NextResponse.json(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 },
      );
    }

    // 3. Mark the token as used
    const now = new Date().toISOString();
    await sb
      .from('password_resets')
      .update({ used_at: now })
      .eq('id', resetRecord.id);

    console.log('[reset-password] ✅ Password reset for', resetRecord.email);

    return NextResponse.json({
      success: true,
      message: 'Password has been reset. You can now sign in with your new password.',
      email: resetRecord.email,
    });
  } catch (err: any) {
    console.error('[reset-password] Error:', err.message);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
