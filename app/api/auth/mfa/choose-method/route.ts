// ─── POST /api/auth/mfa/choose-method ──────────────────
// Sets the user's MFA method without TOTP setup (for email OTP).
// Auth required.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/get-server-user';

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
    const { method } = await req.json();

    if (!method || !['totp', 'email'].includes(method)) {
      return NextResponse.json({ error: 'Method must be "totp" or "email"' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const sb = supabase as any;

    if (method === 'email') {
      // Email OTP: no setup needed — just mark the method
      const { error } = await sb.from('users').update({
        mfa_method: 'email',
        mfa_enabled: true,
      }).eq('id', userId);

      if (error) {
        console.error('[mfa/choose-method] Update error:', error.message);
        return NextResponse.json({ error: 'Failed to set MFA method' }, { status: 500 });
      }

      return NextResponse.json({ success: true, mfa_method: 'email', mfa_enabled: true });
    }

    // TOTP: just mark intent — actual secret is in setup-totp
    const { error } = await sb.from('users').update({
      mfa_method: 'totp',
    }).eq('id', userId);

    if (error) {
      console.error('[mfa/choose-method] Update error:', error.message);
      return NextResponse.json({ error: 'Failed to set MFA method' }, { status: 500 });
    }

    return NextResponse.json({ success: true, mfa_method: 'totp' });
  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }
    console.error('[mfa/choose-method] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
