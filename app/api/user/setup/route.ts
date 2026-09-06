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
  conc_single_pct?: number | null;
  conc_top3_pct?: number | null;
  demo_start_at?: boolean | null; // signal to set demo_start_at if null
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

  console.log('[user/setup] auth result:',
    authUser ? 'ok: ' + authUser.id : 'failed: ' + (authError ? authError.status : 'unknown'));

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

  // ── Returning user guard (relaxed) ──────────────────────
  // Allow patch if the user is missing name fields or demo_start_at.
  const { data: existing } = await (adminSupabase as any)
    .from('users')
    .select('demo_start_at, connection_type, first_name, last_name, investor_style')
    .eq('id', authUser.id)
    .maybeSingle();

  const hasFullProfile = existing?.first_name && existing?.last_name && existing?.investor_style;
  const hasDemoOrBroker = existing?.demo_start_at || existing?.connection_type;

  if (hasFullProfile && hasDemoOrBroker) {
    return NextResponse.json({ success: true, returning: true });
  }

  console.log('[user/setup] upserting users row for:', authUser.id);

  const setupFirstName = body.first_name || '';
  const setupLastName = body.last_name || '';

  // Set demo_start_at if signalled and not already set
  const shouldSetDemoStart = body.demo_start_at === true && !existing?.demo_start_at;
  const demoStartNow = shouldSetDemoStart ? now : undefined;

  const upsertPayload: Record<string, any> = {
    id: authUser.id,
    email: authUser.email || undefined,
    first_name: setupFirstName || undefined,
    last_name: setupLastName || undefined,
    investor_style: body.investor_style || undefined,
    risk_tolerance: body.risk_tolerance || undefined,
    conc_single_pct: body.conc_single_pct ?? undefined,
    conc_top3_pct: body.conc_top3_pct ?? undefined,
    investor_style_onboarded: true,
    tier: 'demo',
    first_open: now,
    last_login_at: now,
  };

  if (demoStartNow) {
    upsertPayload.demo_start_at = demoStartNow;
    upsertPayload.demo_expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  console.log('[user/setup] upsert payload:', {
    hasName: !!(setupFirstName || setupLastName),
    hasStyle: !!body.investor_style,
    setDemoStart: shouldSetDemoStart,
  });

  const { error: upsertError } = await (adminSupabase as any)
    .from('users')
    .upsert(upsertPayload, { onConflict: 'id', ignoreDuplicates: false });

  if (upsertError) {
    console.error('[user/setup] upsert error:', upsertError.message);
    return NextResponse.json(
      { error: 'Setup failed' },
      { status: 500 },
    );
  }

  // ── Accept pending invite (invite-only gate) ──
  if (authUser.email) {
    try {
      const { error: acceptErr } = await (adminSupabase as any)
        .from('invites')
        .update({ status: 'accepted', accepted_at: now })
        .eq('email', authUser.email.toLowerCase().trim())
        .eq('status', 'pending');

      if (acceptErr && !acceptErr.message?.includes('does not exist')) {
        console.warn('[user/setup] Invite acceptance failed:', acceptErr.message);
      }
    } catch (e: any) {
      // Invites table might not exist — non-blocking
      console.warn('[user/setup] Invite accept error (non-blocking):', e.message);
    }
  }

  return NextResponse.json({ success: true });
}
