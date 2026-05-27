// ─── POST /api/db/users/create ──────────────────────────────────
// Creates a new user record in the users table.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify auth
    const { userId, token } = await requireAuth(req);
    const supabase = createServerClient();

    // Parse body
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { email, displayName, avatarUrl } = body as {
      email?: string;
      displayName?: string;
      avatarUrl?: string;
    };

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Check if user already exists
    const { data: existing } = await (supabase as any)
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'User already exists', id: existing.id },
        { status: 409 }
      );
    }

    // Create user — match the auth.uid() with the row id (RLS requires this)
    const { data, error } = await (supabase as any)
      .from('users')
      .insert({
        id: userId,
        email,
        display_name: displayName || email?.split('@')[0] || null,
        avatar_url: avatarUrl || null,
        auth_provider: 'email',
      })
      .select('id, email, display_name, avatar_url, created_at')
      .single();

    if (error) {
      console.error('[users/create] Insert failed:', error.message);
      return NextResponse.json(
        { error: 'Failed to create user', detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: data.id,
      email: data.email,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[users/create] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: err?.message },
      { status: 500 }
    );
  }
}
