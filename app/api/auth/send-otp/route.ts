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

// Rate limit: max 1 send per 15s per email
const cooldown = new Map<string, number>();

const COOLDOWN_MS = 15_000; // 15s — short enough to not block locked-out resends

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Rate limit
    const last = cooldown.get(normalizedEmail);
    if (last && Date.now() - last < COOLDOWN_MS) {
      return NextResponse.json({ error: 'Please wait before requesting again' }, { status: 429 });
    }
    cooldown.set(normalizedEmail, Date.now());

    const supabase = getServiceClient();
    const sb = supabase as any;

    // Find user — fallback: create users row if auth user exists but no users row
    let userRows: any; let userErr: any;
    const result = await sb
      .from('users')
      .select('id, email, email_verified')
      .eq('email', normalizedEmail)
      .limit(1);
    userRows = result.data; userErr = result.error;

    if (userErr || !userRows?.length) {
      // Check if auth user exists — create users row if so
      const { data: authUsers, error: authErr } = await sb.auth.admin.listUsers({
        filter: `email=="${normalizedEmail}"`,
      });

      if (authErr || !authUsers?.users?.length) {
        return NextResponse.json({ error: 'No account found with this email' }, { status: 404 });
      }

      const authUser = authUsers.users[0];
      // Auto-create missing users row
      const { error: createErr } = await sb
        .from('users')
        .insert({
          id: authUser.id,
          email: normalizedEmail,
          email_verified: false,
          status: 'active',
          tier: 'demo',
          demo_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          first_open: new Date().toISOString(),
          auth_provider: 'email',
        });

      if (createErr) {
        console.error('[send-otp] Failed to create users row:', createErr.message);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
      }

      // Re-query to get the full row
      const { data: newRows } = await sb
        .from('users')
        .select('id, email, email_verified')
        .eq('email', normalizedEmail)
        .limit(1);

      if (!newRows?.length) {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
      }
      userRows = newRows;
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
