// ─── GET /api/auth/me ────────────────────────────────────────
// Returns the current authenticated user's full profile.
// Uses Supabase HTTP-only cookie auth (no JWT Bearer header).
//
// Data is split across two tables:
//   public.users         → id, email (parent)
//   public.user_profiles → extended profile (FK → users.id)

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET() {
  try {
    const { authUser, authError } = await requireAuth();
    if (authError) return authError;

    const userId = authUser!.id;
    const email = authUser!.email;
    const serviceDb = createServerClient() as any;

    // Fetch from both tables in parallel
    const [userResult, profileResult] = await Promise.all([
      serviceDb.from('users').select('id, email, demo_start_at, portfolio_mode').eq('id', userId).single(),
      serviceDb.from('user_profiles').select(`
        id,
        first_name,
        last_name,
        display_name,
        avatar_url,
        investor_style,
        risk_tolerance,
        investor_style_onboarded,
        investor_style_set_at,
        tier,
        demo_expires_at,
        first_open,
        created_at,
        last_login
      `).eq('id', userId).single(),
    ]);

    const userRow = userResult.data;
    const profile = profileResult.data;

    if (!userRow && !profile) {
      return NextResponse.json({
        user: {
          id: userId,
          email: email || '',
          displayName: email?.split('@')[0] || '',
          firstName: '',
          lastName: '',
          investorStyle: 'buffett',
          investorStyleSetAt: null,
          investorStyleOnboarded: false,
          riskTolerance: 'Moderate',
          tier: 'demo',
          demoStartAt: null,
          demoExpiresAt: null,
          portfolioMode: 'demo',
          firstOpen: null,
          createdAt: '',
          lastLogin: null,
        },
      });
    }

    return NextResponse.json({
      user: {
        id: userId,
        email: userRow?.email || email || '',
        displayName: profile?.first_name || profile?.display_name || email?.split('@')[0] || '',
        firstName: profile?.first_name || '',
        lastName: profile?.last_name || '',
        avatarUrl: profile?.avatar_url || undefined,
        investorStyle: profile?.investor_style || 'buffett',
        investorStyleSetAt: profile?.investor_style_set_at || undefined,
        investorStyleOnboarded: profile?.investor_style_onboarded ?? false,
        riskTolerance: profile?.risk_tolerance || 'Moderate',
        tier: profile?.tier || 'demo',
        demoStartAt: userRow?.demo_start_at || null,
        demoExpiresAt: profile?.demo_expires_at || null,
        portfolioMode: userRow?.portfolio_mode || 'demo',
        firstOpen: profile?.first_open || null,
        createdAt: profile?.created_at || '',
        lastLogin: profile?.last_login || null,
      },
    });
  } catch (err: any) {
    console.error('[auth/me] Error:', err?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
