// ─── GET /api/auth/me — Current user profile ────────────────
// Returns the authenticated user's data from public.users.
// Reads ONLY public.users — no user_profiles dependency.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET() {
  const { authUser, authError } = await requireAuth();

  if (authError || !authUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const supabase = createServerClient();

  const { data: userData } = await (supabase as any)
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  return NextResponse.json({
    user: {
      id: authUser.id,
      email: authUser.email,
      first_name: userData?.first_name ?? null,
      last_name: userData?.last_name ?? null,
      investor_style: userData?.investor_style ?? null,
      risk_tolerance: userData?.risk_tolerance ?? null,
      conc_single_pct: userData?.conc_single_pct ?? null,
      conc_top3_pct: userData?.conc_top3_pct ?? null,
      tier: userData?.tier ?? 'demo',
      demo_start_at: userData?.demo_start_at ?? null,
      demo_expires_at: userData?.demo_expires_at ?? null,
      connection_type: userData?.connection_type ?? null,
      connection_status: userData?.connection_status ?? null,

      // Legacy camelCase fields for
      // checkQuizComplete() and any other
      // code expecting this shape
      investorStyleOnboarded:
        userData?.investor_style_onboarded ?? false,
      investorStyle: userData?.investor_style ?? null,
      riskTolerance: userData?.risk_tolerance ?? null,
      concSinglePct: userData?.conc_single_pct ?? null,
      concTop3Pct: userData?.conc_top3_pct ?? null,
      displayName: userData?.first_name
        ? `${userData.first_name} ${userData.last_name ?? ''}`.trim()
        : authUser.email?.split('@')[0] ?? null,

      // snake_case fields needed by useAppState state machine
      investor_style_onboarded:
        userData?.investor_style_onboarded ?? false,
      connection_initiated_at:
        userData?.connection_initiated_at ?? null,

      // Email verification
      email_verified: userData?.email_verified ?? false,

      // MFA status
      mfa_enabled: userData?.mfa_enabled ?? false,
      mfa_method: userData?.mfa_method ?? null,
    },
  });
}
