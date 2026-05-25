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
    console.log('👉 [DEBUG update] === POST /api/db/users/update called ===');

    // Verify auth
    console.log('👉 [DEBUG update] calling requireAuth...');
    const { userId: authUserId } = await requireAuth(req);
    console.log('👉 [DEBUG update] authUserId:', authUserId);

    console.log('👉 [DEBUG update] creating supabase server client...');
    const supabase = createServerClient();

    // Parse body
    const body = await req.json().catch(() => null);
    console.log('👉 [DEBUG update] raw body:', JSON.stringify(body));

    if (!body) {
      console.log('❌ [DEBUG update] Missing request body');
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const {
      userId,
      email,
      displayName,
      avatarUrl,
      investorStyle,
      investorStyleOnboarded,
    } = body as {
      userId?: string;
      email?: string;
      displayName?: string;
      avatarUrl?: string;
      investorStyle?: string;
      investorStyleOnboarded?: boolean;
    };

    if (!userId) {
      console.log('❌ [DEBUG update] userId missing from body');
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    console.log('👉 [DEBUG update] userId:', userId, 'investorStyle:', investorStyle, 'onboarded:', investorStyleOnboarded);

    // Only allow updating own profile
    if (userId !== authUserId) {
      console.log('❌ [DEBUG update] userId mismatch. body:', userId, 'auth:', authUserId);
      return NextResponse.json(
        { error: 'Cannot update other users' },
        { status: 403 }
      );
    }

    // Validate investor style
    if (investorStyle && !VALID_STYLES.includes(investorStyle)) {
      console.log('❌ [DEBUG update] invalid style:', investorStyle, 'valid:', VALID_STYLES);
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
    }

    if (Object.keys(updates).length === 0) {
      console.log('❌ [DEBUG update] no fields to update');
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    console.log('👉 [DEBUG update] calling Supabase... updates:', JSON.stringify(updates));

    const { data, error } = await (supabase as any)
      .from('users')
      .update(updates)
      .eq('id', userId)
      .is('deleted_at', null)
      .select('id, email, display_name, avatar_url, investor_style, investor_style_onboarded, updated_at')
      .single();

    if (error) {
      console.log('❌ [DEBUG update] Supabase error:', JSON.stringify(error));
      console.log('❌ [DEBUG update] Supabase error msg:', error.message, 'code:', error.code, 'details:', error.details);
      return NextResponse.json(
        { error: 'Failed to update user', detail: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      console.log('❌ [DEBUG update] no rows returned — user not found or soft-deleted');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log('✅ [DEBUG update] Supabase success:', JSON.stringify(data));
    console.log('✅ [DEBUG update] Set:', { style: data.investor_style, onboarded: data.investor_style_onboarded });

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
