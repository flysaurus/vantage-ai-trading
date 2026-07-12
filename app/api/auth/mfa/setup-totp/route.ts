// ─── POST /api/auth/mfa/setup-totp ─────────────────────
// Generates a TOTP secret and returns QR code URI + manual key.
// Auth required. Stores secret temporarily (not enabled until confirmed).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth/get-server-user';
import { generateTotpSecret } from '@/lib/totp';

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

    // Get user email
    const supabase = getServiceClient();
    const sb = supabase as any;

    const { data: userRows } = await sb.from('users').select('email').eq('id', userId).limit(1);
    if (!userRows?.length) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const email = userRows[0].email;

    // Generate TOTP secret
    const setup = await generateTotpSecret(email);

    // Store secret + mark method (not enabled yet)
    const { error } = await sb.from('users').update({
      mfa_method: 'totp',
      totp_secret: setup.secret,
      // mfa_enabled stays false until confirmed
    }).eq('id', userId);

    if (error) {
      console.error('[mfa/setup-totp] Update error:', error.message);
      return NextResponse.json({ error: 'Failed to store TOTP secret' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      otpauthUrl: setup.otpauthUrl,
      manualKey: setup.manualKey,
    });
  } catch (err: any) {
    console.error('[mfa/setup-totp] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
