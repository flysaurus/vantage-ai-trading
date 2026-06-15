// ─── POST /api/auth/send-magic-link ───────────────────────────
// Sends a Supabase magic link email for passwordless sign-in.
//
// Body: { email: string, anonymousId: string }
//
// Flow:
// 1. Validate email format
// 2. Store anonymousId in a signed, short-lived cookie (needed
//    for data migration on the callback route)
// 3. Call supabase.auth.signInWithOtp() with emailRedirectTo
// 4. Return { success: true } or error

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/auth/supabase-server';
import crypto from 'crypto';

// Cookie name for the anonymous ID during magic link flow
const ANON_COOKIE = 'vantage-anon-id';
const ANON_COOKIE_MAX_AGE = 15 * 60; // 15 minutes — same as magic link expiry

/**
 * Signs the anonymous ID to prevent tampering.
 * Uses HMAC-SHA256 with SESSION_SECRET.
 */
function signAnonId(anonymousId: string): string {
  const secret = process.env.SESSION_SECRET || 'vantage-dev-secret';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(anonymousId);
  return `${anonymousId}.${hmac.digest('hex')}`;
}

/**
 * Verifies a signed anonymous ID.
 * Returns the original ID if valid, null if tampered.
 */
export function verifyAnonId(signed: string): string | null {
  const dotIndex = signed.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const id = signed.slice(0, dotIndex);
  const expected = signAnonId(id);
  return expected === signed ? id : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, anonymousId } = body as { email?: string; anonymousId?: string };

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    console.log('[send-magic-link] Sending magic link to:', email);

    const supabase = await getSupabaseServerClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

    const { error } = await supabase.auth.signInWithOtp({
      email: email.toLowerCase().trim(),
      options: {
        emailRedirectTo: `${appUrl}/auth/callback`,
        shouldCreateUser: true,
      },
    });

    if (error) {
      console.error('[send-magic-link] Supabase error:', error.message);

      // Rate limit or other Supabase errors
      if (error.message.includes('rate') || error.status === 429) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait a moment and try again.' },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: error.message || 'Failed to send magic link' },
        { status: 500 }
      );
    }

    // Store anonymousId in a signed, HTTP-only, short-lived cookie
    // The callback route reads this to perform data migration
    const response = NextResponse.json({ success: true });

    if (anonymousId && typeof anonymousId === 'string') {
      const signed = signAnonId(anonymousId);
      response.cookies.set(ANON_COOKIE, signed, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: ANON_COOKIE_MAX_AGE,
      });
      console.log('[send-magic-link] Stored anonymous ID in cookie');
    }

    console.log('[send-magic-link] ✅ Magic link sent successfully');
    return response;
  } catch (err: any) {
    console.error('[send-magic-link] Unexpected error:', err.message);
    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 }
    );
  }
}
