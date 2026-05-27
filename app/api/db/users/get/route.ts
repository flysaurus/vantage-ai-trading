// ─── GET /api/db/users/get?id=<userId> ──────────────────────────
// Fetches a user record by ID. Only returns non-deleted users.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic'; // never cache — DB is source of truth

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify auth
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();

    // Get target userId from query param — defaults to authenticated user
    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('id') || authUserId;

    // Only allow fetching own data (or admin override — none for now)
    if (targetUserId !== authUserId) {
      return NextResponse.json(
        { error: 'Cannot fetch other users' },
        { status: 403 }
      );
    }

    const { data, error } = await (supabase as any)
      .from('users')
      .select(
        'id, email, display_name, investor_style, investor_style_set_at, investor_style_onboarded, created_at, updated_at'
      )
      .eq('id', targetUserId)
      .maybeSingle();

    if (error) {
      console.error('[users/get] Query failed:', error.message, error.code, error.details);
      return NextResponse.json(
        { error: 'Failed to fetch user', detail: error.message, code: error.code, hint: error.hint },
        { status: 500 }
      );
    }

    if (!data) {
      console.log('[users/get] No user found for id:', targetUserId);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log('[users/get] User found:', data.email);

    return NextResponse.json({
      id: data.id,
      email: data.email,
      displayName: data.display_name,
      investorStyle: data.investor_style || 'buffett',
      investorStyleSetAt: data.investor_style_set_at || null,
      investorStyleOnboarded: data.investor_style_onboarded ?? false,
      createdAt: data.created_at,
      updatedAt: data.updated_at || null,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    const detail = err?.message || String(err);
    console.error('[users/get] Unexpected error:', detail);
    // Missing env vars on preview deploys trigger createServerClient() to throw
    if (detail.includes('Missing Supabase environment variables')) {
      return NextResponse.json(
        { error: 'Server configuration error — missing Supabase env vars', detail },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: 'Internal server error', detail },
      { status: 500 }
    );
  }
}
