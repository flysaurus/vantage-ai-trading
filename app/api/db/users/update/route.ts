// ─── POST /api/db/users/update ──────────────────────────────────
// Updates user fields. Sets updated_at automatically via trigger.
// Requires: Authorization header with valid Bearer token.
//
// Body: { userId, email?, displayName?, avatarUrl?, investorStyle?, investorStyleOnboarded? }

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

const VALID_STYLES = ['buffett', 'lynch', 'livermore', 'soros', 'munger'];

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const {
      userId,
      email,
      displayName,
      avatarUrl,
      investorStyle,
      investorStyleOnboarded,
      investorStyleSetAt,
    } = body as {
      userId?: string;
      email?: string;
      displayName?: string;
      avatarUrl?: string;
      investorStyle?: string;
      investorStyleOnboarded?: boolean;
      investorStyleSetAt?: string;
    };

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Only allow updating own profile
    if (userId !== authUserId) {
      return NextResponse.json(
        { error: 'Cannot update other users' },
        { status: 403 }
      );
    }

    // Validate investor style
    if (investorStyle && !VALID_STYLES.includes(investorStyle)) {
      return NextResponse.json(
        {
          error: `Invalid investor style: "${investorStyle}"`,
          valid: VALID_STYLES,
        },
        { status: 400 }
      );
    }

    // Build update payload (snake_case)
    const updates: Record<string, unknown> = {};
    if (email !== undefined) updates.email = email;
    if (displayName !== undefined) updates.display_name = displayName;
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
    if (investorStyle !== undefined) {
      updates.investor_style = investorStyle;
      updates.investor_style_set_at = new Date().toISOString();
    }
    if (investorStyleOnboarded !== undefined) {
      updates.investor_style_onboarded = investorStyleOnboarded;
      // Auto-set timestamp when onboarding is completed, unless explicitly provided
      if (investorStyleOnboarded && !updates.investor_style_set_at) {
        updates.investor_style_set_at = investorStyleSetAt || new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await (supabase as any)
      .from('users')
      .update(updates)
      .eq('id', userId)
      .is('deleted_at', null)
      .select('id, email, display_name, avatar_url, investor_style, investor_style_onboarded, updated_at')
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update user', detail: error.message },
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
      investorStyleOnboarded: data.investor_style_onboarded ?? false,
      updatedAt: data.updated_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[users/update] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: err?.message },
      { status: 500 }
    );
  }
}
