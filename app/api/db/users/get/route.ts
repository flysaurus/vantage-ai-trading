// ─── GET /api/db/users/get?id=<userId> ──────────────────────────
// Fetches a user record by ID. Only returns non-deleted users.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

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
        'id, email, display_name, avatar_url, investor_style, investor_style_set_at, investor_style_onboarded, created_at, updated_at'
      )
      .eq('id', targetUserId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      console.error('[users/get] Query failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to fetch user', detail: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: data.id,
      email: data.email,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      investorStyle: data.investor_style || 'buffett',
      investorStyleSetAt: data.investor_style_set_at,
      investorStyleOnboarded: data.investor_style_onboarded ?? false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[users/get] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: err?.message },
      { status: 500 }
    );
  }
}
