// ─── GET /api/auth/me ────────────────────────────────────────
// Returns the current authenticated user's full profile.
// Validates the Supabase JWT from the Authorization header.
// Fetches all onboarding + profile data from the users table.

import { NextResponse } from 'next/server';
import { createAuthClient, createServerClient } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Verify the Supabase JWT
    const authClient = createAuthClient();
    const { data: authData, error: authError } = await authClient.auth.getUser(token);

    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const userId = authData.user.id;
    const email = authData.user.email;

    // Fetch full profile from users table (all onboarding + auth fields)
    const serviceDb = createServerClient() as any;
    const { data: profile } = await serviceDb
      .from('users')
      .select(`
        id,
        email,
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
      `)
      .eq('id', userId)
      .single();

    if (!profile) {
      // User exists in Supabase Auth but not in our users table yet
      // Return minimal profile so the UI can trigger profile creation
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
        id: profile.id,
        email: profile.email,
        displayName: profile.first_name || profile.display_name || profile.email?.split('@')[0] || '',
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
