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
  let body: SetupBody & { access_token?: string };
  try {
    body = (await req.json()) as SetupBody & { access_token?: string };
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Auth: try Bearer token first, fall back to cookie session
  let userId: string;
  let userEmail: string;

  if (body.access_token) {
    // Verify the access token with Supabase
    const { data: { user }, error: verifyError } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    ).auth.getUser(body.access_token);

    if (verifyError || !user) {
      console.error('[user/setup] token verification failed:', verifyError?.message);
      return NextResponse.json(
        { error: 'Invalid access token', detail: verifyError?.message },
        { status: 401 },
      );
    }

    userId = user.id;
    userEmail = user.email!;
    console.log('[user/setup] authenticated via access_token:', userId, userEmail);
  } else {
    const { authUser, authError } = await requireAuth();
    if (authError) {
      console.error('[user/setup] requireAuth failed — no session cookie');
      return authError;
    }
    userId = authUser.id;
    userEmail = authUser.email;
    console.log('[user/setup] authenticated via cookie:', userId, userEmail);
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('[user/setup] SUPABASE_SERVICE_ROLE_KEY is empty!');
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey!,
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
    .eq('id', userId)
    .maybeSingle();

  if (existing?.demo_start_at || existing?.connection_type) {
    return NextResponse.json({ success: true, returning: true });
  }

  console.log('[user/setup] upserting users row for:', userId);
  const { error } = await supabase.from('users').upsert(
    {
      id: userId,
      email: userEmail || undefined,
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
    .eq('id', userId)
    .is('first_open', null);

  return NextResponse.json({ success: true });
}
