// ─── POST /api/auth/mfa/verify ─────────────────────────
// Verifies MFA during login. Accepts:
//  - TOTP code from authenticator app
//  - Email OTP (same columns as email verification)
//  - Backup code (only for TOTP users)
// Auth required. On success, marks MFA session as passed.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/get-server-user';
import { verifyTotpToken } from '@/lib/totp';
import { verifyBackupCode } from '@/lib/backup-codes';
import { decryptTotpSecret } from '@/lib/vault';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.authError) return auth.authError;
    const userId = auth.authUser!.id;

    const { code, isBackupCode } = await req.json();
    const cleanCode = String(code || '').trim();

    if (!cleanCode || (cleanCode.length !== 6 && !isBackupCode)) {
      return NextResponse.json({ error: 'Enter your 6-digit code', code: 'INVALID_FORMAT' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const sb = supabase as any;

    const { data: userRows, error: userErr } = await sb.from('users')
      .select('id, email, mfa_enabled, mfa_method, totp_secret, backup_codes, wrong_mfa_attempts, mfa_locked_until, otp_code, otp_expires_at')
      .eq('id', userId).limit(1);

    // If MFA columns don't exist yet (migration not run), gracefully bypass
    if (userErr?.message?.includes('mfa_enabled') || userErr?.message?.includes('column')) {
      return NextResponse.json({ success: true, not_available: true });
    }

    if (!userRows?.length) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const user = userRows[0];

    if (!user.mfa_enabled) {
      return NextResponse.json({ success: true, needs_setup: true });
    }

    // Check lockout
    if (user.mfa_locked_until && new Date(user.mfa_locked_until) > new Date()) {
      return NextResponse.json({
        error: 'Too many incorrect attempts. Please wait a few minutes.',
        code: 'LOCKED_OUT',
        lockedUntil: user.mfa_locked_until,
      }, { status: 429 });
    }

    // Already locked out
    if (user.wrong_mfa_attempts >= 5) {
      return NextResponse.json({
        error: 'Too many incorrect attempts. Please wait a few minutes.',
        code: 'LOCKED_OUT',
      }, { status: 429 });
    }

    let verified = false;
    let usedBackupMode = false;

    // ── TOTP verification ──────────────────────────────
    if (user.mfa_method === 'totp' && !isBackupCode) {
      const secret = decryptTotpSecret(userId, user.totp_secret);
      if (!secret) {
        return NextResponse.json({ error: 'TOTP not configured. Contact support.' }, { status: 500 });
      }
      verified = await verifyTotpToken(secret, cleanCode);
    }

    // ── Backup code verification ───────────────────────
    if (isBackupCode && user.mfa_method === 'totp') {
      const backupCodes = user.backup_codes || [];
      const result = verifyBackupCode(cleanCode, backupCodes);

      if (result.valid) {
        verified = true;
        usedBackupMode = true;
        // Mark backup code as used
        backupCodes[result.index].used = true;
        await sb.from('users').update({
          backup_codes: backupCodes,
          wrong_mfa_attempts: 0,
          mfa_locked_until: null,
        }).eq('id', userId);
      }
    }

    // ── Email OTP verification ─────────────────────────
    if (user.mfa_method === 'email') {
      if (!user.otp_code) {
        return NextResponse.json({ error: 'No code has been sent. Request one first.', code: 'NO_OTP' }, { status: 400 });
      }

      // Check expiry
      if (user.otp_expires_at && new Date(user.otp_expires_at) < new Date()) {
        return NextResponse.json({ error: 'This code has expired. Request a new one.', code: 'EXPIRED' }, { status: 410 });
      }

      if (cleanCode === user.otp_code) {
        verified = true;
        // Clear OTP on success
        await sb.from('users').update({
          otp_code: null,
          otp_expires_at: null,
          wrong_otp_attempts: 0,
          wrong_mfa_attempts: 0,
          mfa_locked_until: null,
        }).eq('id', userId);
      } else {
        // Wrong email OTP — reuse the same attempt tracker (wrong_otp_attempts)
        const newAttempts = (user.wrong_otp_attempts || 0) + 1;
        await sb.from('users').update({
          wrong_otp_attempts: newAttempts,
        }).eq('id', userId);

        const remaining = 5 - newAttempts;
        if (newAttempts >= 5) {
          await sb.from('users').update({
            wrong_mfa_attempts: 5,
            mfa_locked_until: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          }).eq('id', userId);
          return NextResponse.json({ error: 'Too many incorrect attempts. Please wait.', code: 'LOCKED_OUT' }, { status: 429 });
        }

        return NextResponse.json({
          error: 'That code is incorrect. Check your email and try again.',
          code: 'WRONG_CODE',
          attempts_remaining: remaining,
        }, { status: 400 });
      }
    }

    // ── Wrong code (TOTP / Backup) ────────────────────
    if (!verified) {
      const newAttempts = (user.wrong_mfa_attempts || 0) + 1;
      const update: any = { wrong_mfa_attempts: newAttempts };

      if (newAttempts >= 5) {
        update.mfa_locked_until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      }

      await sb.from('users').update(update).eq('id', userId);

      if (newAttempts >= 5) {
        return NextResponse.json({
          error: 'Too many incorrect attempts. Please wait 5 minutes and try again.',
          code: 'LOCKED_OUT',
        }, { status: 429 });
      }

      return NextResponse.json({
        error: 'That code is incorrect. Try again.',
        code: 'WRONG_CODE',
        attempts_remaining: 5 - newAttempts,
      }, { status: 400 });
    }

    // ── Success ────────────────────────────────────────
    // Reset MFA attempts
    if (!usedBackupMode) {
      await sb.from('users').update({
        wrong_mfa_attempts: 0,
        mfa_locked_until: null,
      }).eq('id', userId);
    }

    console.log('[mfa/verify] ✅ MFA verified for user', userId, '(method:', user.mfa_method + (usedBackupMode ? '/backup' : '') + ')');

    return NextResponse.json({
      success: true,
      mfa_method: user.mfa_method,
      used_backup_code: usedBackupMode,
    });
  } catch (err: any) {
    console.error('[mfa/verify] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
