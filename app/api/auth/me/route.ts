// ─── GET /api/auth/me — Current user profile ────────────────
// Returns the authenticated user's data from public.users.
// Auth: cookies (Supabase session) OR Bearer token (sessionStorage bridge).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  // 1. Try cookie-based auth
  let { authUser, authError } = await requireAuth(request);

  // 2. Fall back to Bearer token
  if (!authUser) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const supabase = createServerClient();
        const { data: { user }, error } = await (supabase as any).auth.getUser(token);
        if (user && !error) {
          authUser = { id: user.id, email: user.email || '' };
          authError = null;
        }
      } catch(e) {
        console.warn('[api/auth/me] Bearer token verification failed:', e);
      }
    }
  }

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
      displayName: userData?.first_name
        ? `${userData.first_name} ${userData.last_name ?? ''}`.trim()
        : authUser.email?.split('@')[0] ?? null,

      // snake_case fields needed by useAppState state machine
      investor_style_onboarded:
        userData?.investor_style_onboarded ?? false,
      connection_initiated_at:
        userData?.connection_initiated_at ?? null,
    },
  });
}
