// ─── POST /api/connections/start ──────────────────────────────
// DEBUG v2 — error codes in response body for diagnosis

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  let step = '0_init';
  try {
    // Step 1: Parse body
    step = '1_body';
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'STEP_1_INVALID_JSON' }, { status: 400 });
    }

    const slug = (body.brokerage_slug as string)?.trim();
    if (!slug) {
      return NextResponse.json({ error: 'STEP_1_NO_SLUG' }, { status: 400 });
    }

    // Step 2: Auth
    step = '2_import_auth';
    const { requireAuth } = await import('@/lib/auth/get-server-user');
    const authResult = await requireAuth();
    if (authResult.authError) return authResult.authError;

    // Step 3: Supabase
    step = '3_import_supabase';
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Step 4: SnapTrade auth
    step = '4_import_snaptrade_auth';
    const { getAllowedBrokerages } = await import('@/lib/snaptrade/auth');
    const brokers = await getAllowedBrokerages();
    const broker = brokers.find(b => b.slug.toUpperCase() === slug.toUpperCase());
    if (!broker) {
      return NextResponse.json({ error: `STEP_4_UNKNOWN_BROKER:${slug}` }, { status: 400 });
    }

    // Step 5: SnapTrade client
    step = '5_import_snaptrade_client';
    const { getOrCreateSnapTradeUser } = await import('@/lib/snaptrade/client');
    const result = await getOrCreateSnapTradeUser(
      authResult.authUser.id,
      undefined,
      undefined,
    );

    // Success!
    return NextResponse.json({
      success: true,
      debug: {
        step: 'ALL_PASSED',
        userId: result.userId.substring(0, 12),
        isNew: result.isNew,
        brokersFound: brokers.length,
      },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `CRASH_AT_${step}: ${msg.substring(0, 200)}` },
      { status: 500 },
    );
  }
}
