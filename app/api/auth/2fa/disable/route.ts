// ─── POST /api/auth/2fa/disable ─────────────────────────────────
// Disables 2FA for the authenticated user. Requires password.

import { NextRequest, NextResponse } from 'next/server';
import { disable2FA } from '@/lib/auth-service';
import { createServerClient } from '@/lib/supabase';
import { hashSessionToken } from '@/lib/crypto';

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));

  console.log('👉 [API] Disable 2FA');

  if (!password) {
    return NextResponse.json(
      { error: 'Password required' },
      { status: 400 }
    );
  }

  try {
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

    const result = await disable2FA(session.user_id, password);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('❌ Disable 2FA error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to disable 2FA' },
      { status: 400 }
    );
  }
}
