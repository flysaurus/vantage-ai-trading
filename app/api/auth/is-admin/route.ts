// ─── GET /api/auth/is-admin ─────────────────────────────────────
// Returns { isAdmin: true } if the authenticated user's email
// is in the admin allowlist. Returns { isAdmin: false } for
// non-admin users (200 OK; never leaks 403).
//
// This is a UI convenience endpoint—the real server-side
// requireAdmin() gate on /admin/* remains unchanged.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';

// Duplicated from admin-check.ts (can't use requireAdmin here—
// it returns 403, which leaks auth state to non-admins).
function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? 'mparikh01@gmail.com';
  return new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

export async function GET() {
  const { authUser } = await requireAuth();
  const email = authUser?.email?.toLowerCase();
  const isAdmin = email ? getAdminEmails().has(email) : false;
  return NextResponse.json({ isAdmin });
}
