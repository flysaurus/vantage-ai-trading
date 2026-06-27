// ─── POST /api/db/users/delete ──────────────────────────────────
// Soft-deletes a user by setting deleted_at = NOW().
// The row stays in the DB but is excluded from reads.
// Requires: Authorization header with valid Bearer token.
//
// Body: { userId }

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify auth
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();

    // Parse body
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { userId } = body as { userId?: string };
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Only allow deleting own account
    if (userId !== authUserId) {
      return NextResponse.json(
        { error: 'Cannot delete other users' },
        { status: 403 }
      );
    }

    // Check user exists and isn't already deleted
    const { data: existing } = await (supabase as any)
      .from('users')
      .select('id, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (existing.deleted_at) {
      return NextResponse.json(
        { error: 'User already deleted', deletedAt: existing.deleted_at },
        { status: 409 }
      );
    }

    // Soft delete
    const now = new Date().toISOString();
    const { error } = await (supabase as any)
      .from('users')
      .update({ deleted_at: now })
      .eq('id', userId);

    if (error) {
      console.error('[users/delete] Soft delete failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to delete user', detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedAt: now,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[users/delete] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: err?.message },
      { status: 500 }
    );
  }
}
