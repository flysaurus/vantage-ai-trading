// ─── Admin Access Control ──────────────────────────────────────
// Primary gate: DB is_admin column on the users table (migration 029).
// Fallback: ADMIN_EMAILS env var (comma-separated), transitional safety net.
//
// Every admin page and admin API route must call requireAdmin() before
// doing anything else. The return pattern is { adminUser, adminError } —
// both API routes and server components use the same contract.
//
// Audit trail: all admin actions (tier overrides, gamification config
// changes, future admin grant/revoke) are logged to admin_audit_log.

import { requireAuth, type ServerUser } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Resolve Allowlist (TRANSITIONAL — remove after DB field is proven) ──

function getAdminEmails(): Set<string> {
  // Use ?? (nullish coalescing) so an explicitly empty ADMIN_EMAILS=""
  // results in an empty set (fail-closed — no one is admin).
  // Unset/undefined falls back to the hardcoded default.
  const raw = process.env.ADMIN_EMAILS ?? 'mparikh01@gmail.com';
  return new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

// ─── requireAdmin ─────────────────────────────────────────────

/**
 * Authenticate the request AND verify the user is an admin.
 *
 * Check order:
 *   1. Authenticate via Supabase session (requireAuth)
 *   2. Check DB users.is_admin field (primary, migration 029)
 *   3. Fall back to ADMIN_EMAILS env var (transitional, see below)
 *
 * TRANSITIONAL FALLBACK: ADMIN_EMAILS remains as a safety net.
 * If the DB check fails (e.g. migration not yet run, column missing),
 * we still check the env var so no admin gets locked out.
 * This fallback should be removed once the DB field is proven stable
 * across multiple production deployments.
 *
 * On success:  { adminUser: ServerUser, adminError: null }
 * On failure:  { adminUser: null, adminError: NextResponse }
 *
 * Failure cases:
 *   - No valid Supabase session → 401 (delegates to requireAuth)
 *   - Valid session but not admin → 403
 *
 * Usage (API route):
 *   const { adminUser, adminError } = await requireAdmin(req);
 *   if (adminError) return adminError;
 *
 * Usage (server component):
 *   const { adminUser, adminError } = await requireAdmin();
 *   if (adminError) redirect('/login');
 */
export async function requireAdmin(
  request?: NextRequest
): Promise<
  | { adminUser: ServerUser; adminError: null }
  | { adminUser: null; adminError: NextResponse }
> {
  const { authUser, authError } = await requireAuth(request);

  // Not authenticated — pass through requireAuth's 401 response
  if (authError) {
    return { adminUser: null, adminError: authError };
  }

  const email = authUser.email?.toLowerCase();
  if (!email) {
    return {
      adminUser: null,
      adminError: NextResponse.json(
        { error: 'Admin access required', message: 'No email on account.' },
        { status: 403 }
      ),
    };
  }

  // ── Primary check: DB is_admin field ──
  let dbIsAdmin = false;
  try {
    const supabase = createServerClient();
    const { data, error } = await (supabase as any)
      .from('users')
      .select('is_admin')
      .eq('id', authUser.id)
      .maybeSingle();

    if (!error && data) {
      dbIsAdmin = data.is_admin === true;
    } else if (error) {
      // Column might not exist yet (migration not run) — log and continue
      console.warn('[requireAdmin] DB is_admin check failed (migration pending?):', error?.message || error);
    }
  } catch (e: any) {
    console.warn('[requireAdmin] DB is_admin query exception:', e.message);
  }

  if (dbIsAdmin) {
    return { adminUser: authUser, adminError: null };
  }

  // ── TRANSITIONAL FALLBACK: ADMIN_EMAILS env var ──
  // Remove this block once DB is_admin is proven stable in production.
  const adminEmails = getAdminEmails();
  if (adminEmails.has(email)) {
    console.log(`[requireAdmin] ADMIN_EMAILS fallback granted for ${email} (DB is_admin was false)`);
    return { adminUser: authUser, adminError: null };
  }

  return {
    adminUser: null,
    adminError: NextResponse.json(
      {
        error: 'Admin access required',
        email: authUser.email,
        message:
          'Your account does not have admin access. Contact the administrator.',
      },
      { status: 403 }
    ),
  };
}
