// ─── POST /api/auth/check-email ────────────────────────────
// Pre-auth check: is this email already registered?
// Uses service role to query BOTH public.users (confirmed)
// AND auth.users (unconfirmed) so the signup form can show
// the right message.
//
// No requireAuth() — this is called before signup.
//
// Response:
//   { exists: false, confirmed: false }  — email is free
//   { exists: true,  confirmed: false }  — unconfirmed (can resend)
//   { exists: true,  confirmed: true  }  — confirmed (sign in)
//
// Performance note: listUsers() fetches all auth users.
// Acceptable for small user base; replace with
// auth.admin.getUserByEmail() when available.
//
// Security: fails open (returns exists:false on any error).

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Simple in-memory rate limit (per-route-instance, resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;        // requests per window
const RATE_WINDOW_MS = 60000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  // ── Rate limit ─────────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json({ exists: false, confirmed: false });
  }

  // ── Parse body ─────────────────────────────────────────
  let email: string;
  try {
    const body = await req.json();
    email = (body.email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ exists: false, confirmed: false });
  }

  if (!email || !isValidEmail(email)) {
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

    // ── Check 1: public.users (confirmed accounts) ──────
    const { data: publicUser, error: publicError } = await supabase
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (publicUser && !publicError) {
      return NextResponse.json({ exists: true, confirmed: true });
    }

    // ── Check 2: auth.users (includes unconfirmed) ───────
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      // Fail open — don't block signup on listUsers error
      return NextResponse.json({ exists: false, confirmed: false });
    }

    const authUser = authData?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    if (authUser) {
      if (authUser.email_confirmed_at) {
        // Confirmed in auth but missing from public — edge case, treat as confirmed
        return NextResponse.json({ exists: true, confirmed: true });
      }
      // Unconfirmed — exists in auth, not in public
      return NextResponse.json({ exists: true, confirmed: false });
    }

    // Not found in either table
    return NextResponse.json({ exists: false, confirmed: false });
  } catch {
    // Fail open
    return NextResponse.json({ exists: false, confirmed: false });
  }
}
