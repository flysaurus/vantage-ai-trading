// ─── POST /api/auth/check-email ────────────────────────────
// Pre-auth check: is this email already registered?
// Uses service role to query public.users directly.
// No requireAuth() — this is called before signup.
//
// Note: auth.users is NOT queryable via REST (Supabase security).
// public.users is populated by /api/user/setup on first login,
// so it's a reliable proxy. If a row exists here, signUp() will
// also reject the email.
//
// Security: fails open (returns false on DB error) so signup
// is never blocked by this check. Supabase signUp() is the
// final gate.

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
    // Fail open — don't block signup on rate limit
    return NextResponse.json({ exists: false });
  }

  // ── Parse body ─────────────────────────────────────────
  let email: string;
  try {
    const body = await req.json();
    email = (body.email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ exists: false });
  }

  // ── Validate email format ──────────────────────────────
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ exists: false });
  }

  // ── Query public.users with service role ───────────────
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

    // Case-insensitive match via ilike
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();

    if (error) {
      // Fail open — don't block signup on DB error
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({ exists: !!data });
  } catch {
    // Fail open
    return NextResponse.json({ exists: false });
  }
}
