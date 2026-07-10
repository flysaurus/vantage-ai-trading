// ─── Admin Access Control ──────────────────────────────────────
// Wraps the existing requireAuth() Supabase cookie check with an email
// allowlist. Both the admin page (server component) and every admin API
// route must call requireAdmin() before doing anything else.
//
// Allowlist: ADMIN_EMAILS env var (comma-separated), fallback to
// mparikh01@gmail.com if unset.

import { requireAuth, type ServerUser } from '@/lib/auth/get-server-user';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Resolve Allowlist ────────────────────────────────────────

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || 'mparikh01@gmail.com';
  return new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

// ─── requireAdmin ─────────────────────────────────────────────

/**
 * Authenticate the request AND verify the user is an admin.
 *
 * On success:  { adminUser: ServerUser, adminError: null }
 * On failure:  { adminUser: null, adminError: NextResponse }
 *
 * Failure cases:
 *   - No valid Supabase session → 401 (delegates to requireAuth)
 *   - Valid session but email not in allowlist → 403
 *
 * Usage (API route):
 *   const { adminUser, adminError } = await requireAdmin(req);
 *   if (adminError) return adminError;
 *
 * Usage (server component):
 *   const { adminUser, adminError } = await requireAdmin();
 *   if (adminError) return <NotAuthorizedPage />;
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

  // Authenticated — check admin allowlist
  const adminEmails = getAdminEmails();
  const email = authUser.email?.toLowerCase();

  if (!email || !adminEmails.has(email)) {
    return {
      adminUser: null,
      adminError: NextResponse.json(
        {
          error: 'Admin access required',
          email: authUser.email,
          message:
            'Your account is not in the admin allowlist. Contact the administrator to request access.',
        },
        { status: 403 }
      ),
    };
  }

  return { adminUser: authUser, adminError: null };
}
