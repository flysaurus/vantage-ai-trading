// ─── POST /api/user/setup — Initial user record upsert ─────
// Called from /welcome after email confirmation.
// Upserts user metadata + tier/demo fields into public.users.
//
// Auth: cookies only (session refreshed by middleware).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

interface SetupBody {
  first_name?: string | null;
  last_name?: string | null;
  investor_style?: string | null;
  risk_tolerance?: string | null;
}

export async function POST(req: NextRequest) {
  let body: SetupBody;
  try {
    body = (await req.json()) as SetupBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Auth: cookies only (correct for this flow)
  const { authUser, authError } = await requireAuth();

  if (authError || !authUser) {
    console.error('[user/setup] cookie auth failed');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  console.log('[user/setup] authenticated via cookie:', authUser.id, authUser.email);

  // Service role client for DB writes (bypasses RLS)
  const adminSupabase = createServerClient();

  const now = new Date().toISOString();

  // ── Returning user guard ─────────────────────────────────
  const { data: existing } = await (adminSupabase as any)
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', authUser.id)
    .maybeSingle();

  if (existing?.demo_start_at || existing?.connection_type) {
    return NextResponse.json({ success: true, returning: true });
  }

  console.log('[user/setup] upserting users row for:', authUser.id);
  const { error: upsertError } = await (adminSupabase as any)
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email: authUser.email || undefined,
        first_name: body.first_name || undefined,
        last_name: body.last_name || undefined,
        investor_style: body.investor_style || undefined,
        risk_tolerance: body.risk_tolerance || undefined,
        investor_style_onboarded: true,
        tier: 'demo',
        first_open: now,
        last_login_at: now,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: false,
      },
    );

  if (upsertError) {
    console.error('[user/setup] upsert error:', upsertError.message);
    return NextResponse.json(
      { error: 'Setup failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
