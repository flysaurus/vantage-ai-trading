// ─── GET /api/auth/is-admin ─────────────────────────────────────
// Returns { isAdmin: true } if the authenticated user has admin access.
// Returns { isAdmin: false } for non-admin users (200 OK; never leaks 403).
//
// Check order:
//   1. DB users.is_admin field (primary, migration 029)
//   2. ADMIN_EMAILS env var fallback (transitional safety net)
//
// This is a UI convenience endpoint — the real server-side
// requireAdmin() gate on /admin/* remains unchanged.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

// TRANSITIONAL FALLBACK — remove once DB is_admin is proven stable
function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? 'mparikh01@gmail.com';
  return new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

export async function GET() {
  const { authUser } = await requireAuth();
  const email = authUser?.email?.toLowerCase();

  if (!email || !authUser) {
    return NextResponse.json({ isAdmin: false });
  }

  // ── Primary: DB is_admin field ──
  try {
    const supabase = createServerClient();
    const { data, error } = await (supabase as any)
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .maybeSingle();

    if (!error && data?.is_admin === true) {
      return NextResponse.json({ isAdmin: true });
    }
  } catch { /* column may not exist yet — fall through to env var */ }

  // ── TRANSITIONAL FALLBACK ──
  const isAdmin = getAdminEmails().has(email);
  return NextResponse.json({ isAdmin });
}
