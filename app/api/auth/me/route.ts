// ─── GET /api/auth/me ───────────────────────────────────────────
// Returns the current user's profile if the session cookie is valid.
// Used by the frontend to restore auth state on page load.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { hashSessionToken } from '@/lib/crypto';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sessionToken = req.cookies.get('session')?.value;

  console.log('👉 [API] Get current user');

  if (!sessionToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const sessionTokenHash = hashSessionToken(sessionToken);

    // Find session
    const { data: session, error: sessionError } = await (supabase as any)
      .from('user_sessions')
      .select('user_id, expires_at')
      .eq('session_token_hash', sessionTokenHash)
      .single();

    if (sessionError || !session) {
      console.error('❌ Session not found');
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      console.error('❌ Session expired');
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }

    // Get user data
    const { data: user, error: userError } = await (supabase as any)
      .from('users')
      .select('id, email, display_name, avatar_url, investor_style, investor_style_onboarded, status, two_factor_enabled')
      .eq('id', session.user_id)
      .single();

    if (userError || !user) {
      console.error('❌ User not found');
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    // Update last activity
    await (supabase as any)
      .from('user_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('user_id', session.user_id);

    console.log('✅ User found:', user.email, '| investor_style:', user.investor_style, '| investor_style_onboarded:', user.investor_style_onboarded, '| type:', typeof user.investor_style_onboarded);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        investorStyle: user.investor_style,
        investorStyleOnboarded: user.investor_style_onboarded,
        status: user.status,
        twoFactorEnabled: user.two_factor_enabled,
      },
    }, { status: 200 });
  } catch (err: any) {
    console.error('❌ Get user error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to get user' },
      { status: 500 }
    );
  }
}
