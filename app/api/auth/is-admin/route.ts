// ─── GET /api/auth/is-admin ─────────────────────────────────────
// Returns { isAdmin: true } if the authenticated user has admin access.
// Check order: DB is_admin → ADMIN_EMAILS env var fallback.
// Include _diag while debugging the settings page rendering issue.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? 'mparikh01@gmail.com';
  return new Set(
    raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

export async function GET() {
  const { authUser } = await requireAuth();
  const email = authUser?.email?.toLowerCase();
  
  // ── Primary: DB is_admin field ──
  let dbIsAdmin = false;
  let dbError: string | null = null;
  try {
    const supabase = createServerClient();
    const { data, error } = await (supabase as any)
      .from('users')
      .select('is_admin')
      .eq('id', authUser?.id)
      .maybeSingle();
    if (!error && data?.is_admin === true) {
      dbIsAdmin = true;
    }
    if (error) dbError = error.message || String(error);
  } catch (e: any) {
    dbError = e.message;
  }

  // ── Fallback: ADMIN_EMAILS ──
  const envIsAdmin = email ? getAdminEmails().has(email) : false;
  const isAdmin = dbIsAdmin || envIsAdmin;

  return NextResponse.json({
    isAdmin,
    _diag: {
      hasSession: !!authUser,
      email: authUser?.email || null,
      dbIsAdmin,
      dbError,
      envIsAdmin,
      envSet: !!process.env.ADMIN_EMAILS,
      envRaw: process.env.ADMIN_EMAILS || '(unset, using default)',
    },
  });
}
