// ─── POST /api/auth/send-otp — Send/Resend OTP ───────────
// Public. Body: { email }
// Generates 6-digit code, stores in users table, sends email.
// Also used for "Resend OTP" — regenerates code, resets attempt counter.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendOtpEmail } from '@/lib/otp-email';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Rate limit: max 1 send per 30s per email
const cooldown = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Rate limit
    const last = cooldown.get(normalizedEmail);
    if (last && Date.now() - last < 30_000) {
      return NextResponse.json({ error: 'Please wait before requesting again' }, { status: 429 });
    }
    cooldown.set(normalizedEmail, Date.now());

    const supabase = getServiceClient();
    const sb = supabase as any;

    // Find user
    const { data: userRows, error: userErr } = await sb
      .from('users')
      .select('id, email, email_verified')
      .eq('email', normalizedEmail)
      .limit(1);

    if (userErr || !userRows?.length) {
      return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });
    }

    // Skip if already verified
    if (userRows[0].email_verified) {
      return NextResponse.json({ success: true, already_verified: true });
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Store OTP
    const { error: updateErr } = await sb
      .from('users')
      .update({
        otp_code: code,
        otp_expires_at: expiresAt,
        wrong_otp_attempts: 0, // Reset attempt counter on new code
      })
      .eq('id', userRows[0].id);

    if (updateErr) {
      console.error('[send-otp] Update error:', updateErr.message);
      return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 });
    }

    // Send email
    try {
      await sendOtpEmail(normalizedEmail, code);
    } catch (emailErr: any) {
      console.error('[send-otp] Email error:', emailErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[send-otp] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
