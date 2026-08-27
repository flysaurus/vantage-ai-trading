// ─── POST /api/auth/mfa/confirm-totp ───────────────────
// Verifies a TOTP code during setup. On success:
//  - Enables MFA (mfa_enabled = true)
//  - Generates 8 backup codes (hashed, stored in DB)
//  - Returns backup codes PLAINTEXT (shown once to user)
// Auth required. Must have pending totp_secret.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/get-server-user';
import { verifyTotpToken } from '@/lib/totp';
import { generateBackupCodes } from '@/lib/backup-codes';
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

    const { code } = await req.json();

    if (!code || code.length !== 6) {
      return NextResponse.json({ error: 'Code must be 6 digits' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const sb = supabase as any;

    // Get stored secret
    const { data: userRows } = await sb.from('users')
      .select('totp_secret, mfa_enabled')
      .eq('id', userId).limit(1);

    if (!userRows?.length) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Don't allow re-setup if already enabled
    if (userRows[0].mfa_enabled) {
      return NextResponse.json({ error: 'MFA is already enabled' }, { status: 400 });
    }

    const secret = decryptTotpSecret(userId, userRows[0].totp_secret);
    if (!secret) {
      return NextResponse.json({ error: 'No TOTP setup in progress. Start setup first.' }, { status: 400 });
    }

    // Verify the code
    const valid = await verifyTotpToken(secret, code);
    if (!valid) {
      return NextResponse.json({
        error: 'That code is incorrect. Check your authenticator app and try again.',
        code: 'WRONG_TOTP',
      }, { status: 400 });
    }

    // Generate backup codes
    const codes = generateBackupCodes();
    const hashedCodes = codes.map((c) => ({ hash: c.hash, used: false }));

    // Store backup codes + enable MFA
    const { error: updateErr } = await sb.from('users').update({
      mfa_enabled: true,
      mfa_method: 'totp',
      backup_codes: hashedCodes,
      wrong_mfa_attempts: 0,
    }).eq('id', userId);

    if (updateErr) {
      console.error('[mfa/confirm-totp] Update error:', updateErr.message);
      return NextResponse.json({ error: 'Failed to enable MFA' }, { status: 500 });
    }

    console.log('[mfa/confirm-totp] ✅ TOTP enabled for user', userId);

    return NextResponse.json({
      success: true,
      mfa_enabled: true,
      mfa_method: 'totp',
      backupCodes: codes.map((c) => c.plaintext),
    });
  } catch (err: any) {
    console.error('[mfa/confirm-totp] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
