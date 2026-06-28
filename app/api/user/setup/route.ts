// ─── POST /api/user/setup — Initial user record upsert ─────
// Called from /welcome after email confirmation.
// Upserts user metadata + tier/demo fields into public.users.
//
// requireAuth() — session must be active (JWT Bearer token).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

interface SetupBody {
  first_name?: string | null;
  last_name?: string | null;
  investor_style?: string | null;
  risk_tolerance?: string | null;
}

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: SetupBody;
  try {
    body = (await req.json()) as SetupBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const now = new Date().toISOString();

  // ── Returning user guard ─────────────────────────────────
  // If the user already has demo_start_at or connection_type set,
  // they accidentally hit /welcome — tell the client to redirect home.
  const { data: existing } = await supabase
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', authUser.id)
    .maybeSingle();

  if (existing?.demo_start_at || existing?.connection_type) {
    return NextResponse.json({ success: true, returning: true });
  }

  const { error } = await supabase.from('users').upsert(
    {
      id: authUser.id,
      email: authUser.email || undefined,
      first_name: body.first_name || undefined,
      last_name: body.last_name || undefined,
      investor_style: body.investor_style || undefined,
      risk_tolerance: body.risk_tolerance || undefined,
      investor_style_onboarded: true,
      tier: 'demo',
      last_login_at: now,
      // first_open: only set if currently null (coalesce handled by upsert)
      first_open: undefined, // upsert won't overwrite existing first_open
    },
    {
      onConflict: 'id',
      // Only merge specified fields; never overwrite demo_start_at or existing connection fields
      ignoreDuplicates: false,
    },
  );

  if (error) {
    console.error('[user/setup] upsert error:', error.message);
    return NextResponse.json(
      { error: 'Failed to set up user account' },
      { status: 500 },
    );
  }

  // If first_open is null, set it now (need a separate update
  // because upsert with undefined won't do it)
  await supabase
    .from('users')
    .update({ first_open: now })
    .eq('id', authUser.id)
    .is('first_open', null);

  return NextResponse.json({ success: true });
}
