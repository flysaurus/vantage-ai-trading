// ─── POST /api/auth/2fa/enable ──────────────────────────────────
// Enables 2FA for the authenticated user.
// Verifies the TOTP code, encrypts secrets, stores in two_factor_auth.

import { NextRequest, NextResponse } from 'next/server';
import { enable2FA } from '@/lib/auth-service';
import { createServerClient } from '@/lib/supabase';
import { hashSessionToken } from '@/lib/crypto';

export async function POST(req: NextRequest) {
  const { secret, totpCode, backupCodes } = await req.json().catch(() => ({}));

  console.log('👉 [API] Enable 2FA');

  if (!secret || !totpCode || !backupCodes) {
    return NextResponse.json(
      { error: 'secret, totpCode, and backupCodes required' },
      { status: 400 }
    );
  }

  try {
    // Authenticate via session cookie
    const rawToken = req.cookies.get('session')?.value;
    if (!rawToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = createServerClient();
    const tokenHash = hashSessionToken(rawToken);

    const { data: session, error: sessionError } = await (supabase as any)
      .from('user_sessions')
      .select('user_id')
      .eq('session_token_hash', tokenHash)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const result = await enable2FA(session.user_id, secret, totpCode, backupCodes);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('❌ Enable 2FA error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to enable 2FA' },
      { status: 400 }
    );
  }
}
