// ─── GET /api/auth/me ────────────────────────────────────────
// Returns the current authenticated user's full profile.
// Validates the Supabase JWT from the Authorization header.
// Reads from user_profiles (where createAccount writes), falls back
// to users table for legacy accounts.

import { NextResponse } from 'next/server';
import { createAuthClient, createServerClient } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    const authClient = createAuthClient();
    const { data: authData, error: authError } = await authClient.auth.getUser(token);

    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const userId = authData.user.id;
    const email = authData.user.email;
    const serviceDb = createServerClient() as any;

    // Try user_profiles first (where createAccount/complete-profile write)
    let profile = null;
    const { data: upData } = await serviceDb
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (upData) {
      profile = upData;
    } else {
      // Fall back to users table (legacy accounts)
      const { data: uData } = await serviceDb
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      profile = uData;
    }

    if (!profile) {
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
          demoExpiresAt: null,
          firstOpen: null,
          createdAt: '',
          lastLogin: null,
        },
      });
    }

    return NextResponse.json({
      user: {
        id: profile.id || profile.user_id || userId,
        email: profile.email || email || '',
        displayName: profile.first_name || profile.display_name || email?.split('@')[0] || '',
        firstName: profile.first_name || '',
        lastName: profile.last_name || '',
        avatarUrl: profile.avatar_url || undefined,
        investorStyle: profile.investor_style || 'buffett',
        investorStyleSetAt: profile.investor_style_set_at || undefined,
        investorStyleOnboarded: profile.investor_style_onboarded ?? false,
        riskTolerance: profile.risk_tolerance || 'Moderate',
        tier: profile.tier || 'demo',
        demoExpiresAt: profile.demo_expires_at || null,
        firstOpen: profile.first_open || null,
        createdAt: profile.created_at || '',
        lastLogin: profile.last_login || null,
      },
    });
  } catch (err: any) {
    console.error('[auth/me] Error:', err?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
