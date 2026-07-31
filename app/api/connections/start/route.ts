// ─── POST /api/connections/start ──────────────────────────────
// DEBUG BUILD — stripped down to isolate the 502 crash

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  console.error('[conn-start] ROUTE LOADED');

  try {
    // Step 1: can we even read the body?
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      console.error('[conn-start] Body parsed:', JSON.stringify(body).substring(0, 200));
    } catch (e) {
      console.error('[conn-start] Body parse FAILED:', e);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Step 2: can we import and call requireAuth?
    let authResult: any;
    try {
      const { requireAuth } = await import('@/lib/auth/get-server-user');
      console.error('[conn-start] requireAuth imported, calling...');
      authResult = await requireAuth();
      console.error('[conn-start] requireAuth result:', authResult.authError ? 'authError' : `user=${authResult.authUser?.id?.substring(0, 8)}`);
    } catch (e) {
      console.error('[conn-start] requireAuth FAILED:', e instanceof Error ? e.stack || e.message : String(e));
      return NextResponse.json({ error: 'Auth module failed to load' }, { status: 500 });
    }

    if (authResult.authError) {
      console.error('[conn-start] Auth ERROR, returning');
      return authResult.authError;
    }

    const authUser = authResult.authUser;
    const slug = body.brokerage_slug as string;
    if (!slug) {
      return NextResponse.json({ error: 'brokerage_slug required' }, { status: 400 });
    }

    // Step 3: can we create supabase client?
    let supabase: any;
    try {
      const { createClient } = await import('@supabase/supabase-js');
      console.error('[conn-start] Supabase env vars:', {
        hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      });
      supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      console.error('[conn-start] Supabase client created');
    } catch (e) {
      console.error('[conn-start] Supabase create FAILED:', e instanceof Error ? e.message : String(e));
      return NextResponse.json({ error: 'DB client failed to init' }, { status: 500 });
    }

    // Step 4: can we import snapTrade modules?
    try {
      const { getAllowedBrokerages } = await import('@/lib/snaptrade/auth');
      console.error('[conn-start] getAllowedBrokerages imported, calling...');
      const brokers = await getAllowedBrokerages();
      console.error(`[conn-start] Got ${brokers.length} brokers`);
      const broker = brokers.find(b => b.slug.toUpperCase() === slug.toUpperCase());
      if (!broker) {
        return NextResponse.json({ error: `Unknown broker: ${slug}` }, { status: 400 });
      }
      console.error(`[conn-start] Broker found: ${broker.displayName}`);
    } catch (e) {
      console.error('[conn-start] SnapTrade import/call FAILED:', e instanceof Error ? e.stack || e.message : String(e));
      return NextResponse.json({ error: 'SnapTrade failed' }, { status: 500 });
    }

    // Step 5: can we import the client modules?
    try {
      const { getOrCreateSnapTradeUser } = await import('@/lib/snaptrade/client');
      console.error('[conn-start] getOrCreateSnapTradeUser imported, calling...');
      const result = await getOrCreateSnapTradeUser(authUser.id, undefined, undefined);
      console.error(`[conn-start] SnapTrade user ready: ${result.userId}, isNew=${result.isNew}`);
    } catch (e) {
      console.error('[conn-start] getOrCreateSnapTradeUser FAILED:', e instanceof Error ? e.stack || e.message : String(e));
      return NextResponse.json({ error: 'SnapTrade user setup failed' }, { status: 500 });
    }

    console.error('[conn-start] ALL CHECKS PASSED — returning success');
    return NextResponse.json({ success: true, debug: 'all steps passed' });

  } catch (e) {
    console.error('[conn-start] FATAL OUTER CRASH:', e instanceof Error ? e.stack || e.message : String(e));
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
