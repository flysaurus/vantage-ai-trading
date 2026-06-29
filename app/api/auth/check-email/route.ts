// ─── POST /api/auth/check-email ────────────────────────────
// Pre-auth check: is this email already registered?
// Uses a SECURITY DEFINER SQL function (check_email_exists)
// that queries auth.users directly — avoiding listUsers() perf
// issues and PostgREST auth-schema restrictions.
//
// Flow:
//   1. Check public.users (confirmed accounts)
//   2. Check auth.users via RPC (unconfirmed accounts)
//   3. If neither → email is free
//
// Response: { exists: boolean, confirmed: boolean }
//
// Security: fails open on any error (never blocks signup).

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let email: string;

  try {
    const body = await req.json();
    email = (body.email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ exists: false, confirmed: false });
  }

  if (!email || !emailRegex.test(email)) {
    return NextResponse.json({ exists: false, confirmed: false });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // ── Step 1: Check public.users (confirmed accounts) ──
    const { data: publicUser } = await supabase
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (publicUser) {
      return NextResponse.json({ exists: true, confirmed: true });
    }

    // ── Step 2: Check auth.users via RPC ──────────────────
    const { data, error } = await supabase.rpc('check_email_exists', {
      lookup_email: email,
    });

    if (error) {
      // Fail open
      console.error('[check-email] RPC error:', error.message);
      return NextResponse.json({ exists: false, confirmed: false });
    }

    // RPC returns [{ found: boolean, confirmed: boolean }]
    const result = Array.isArray(data) ? data[0] : data;

    if (result?.found) {
      return NextResponse.json({
        exists: true,
        confirmed: result.confirmed === true,
      });
    }

    // ── Step 3: Email is free ─────────────────────────────
    return NextResponse.json({ exists: false, confirmed: false });
  } catch (err) {
    // Fail open
    console.error('[check-email] unexpected error:', err);
    return NextResponse.json({ exists: false, confirmed: false });
  }
}
