// ─── POST /api/demo/start — Initialize 30-day demo ─────────
// Called when user taps "Start my 30-day demo" CTA.
// Sets demo_start_at, demo_expires_at, portfolio_mode.
// Seeds cash-only demo account: $100,000 cash, no positions/orders.
//
// ⚠️ CRITICAL: This endpoint DESTROYS existing demo positions and
// orders via seedDemoPortfolio → clearPortfolio. It filters to
// is_demo=true only (never touches live broker data), but it WILL
// reset an active demo. Only full-seed on first activation.
//
// Auth: cookies only (session refreshed by middleware).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';
import { NextResponse } from 'next/server';

export async function POST() {
  // Auth: cookies only
  const { authUser, authError } = await requireAuth();

  if (authError || !authUser) {
    console.error('[demo/start] cookie auth failed');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  console.log('[demo/start] authenticated via cookie:', authUser.id);

  // Service role client for DB writes
  const adminSupabase = createServerClient();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Check if demo is already active — if so, skip destructive re-seed
  const { data: existing } = await (adminSupabase as any)
    .from('users')
    .select('demo_start_at, investor_style')
    .eq('id', authUser.id)
    .single();

  const alreadyActive = existing?.demo_start_at != null;

  if (alreadyActive) {
    // Demo already running — only update timer if expired/extended,
    // NEVER re-seed portfolio (would destroy user's positions/orders)
    console.log('[demo/start] demo already active, skipping seed for', authUser.id);
    const { error: updateError } = await (adminSupabase as any)
      .from('users')
      .update({
        demo_expires_at: expiresAt.toISOString(),
      })
      .eq('id', authUser.id);

    if (updateError) {
      console.error('[demo/start] users update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update demo timer' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      alreadyActive: true,
      demo_start_at: existing.demo_start_at,
      demo_expires_at: expiresAt.toISOString(),
    });
  }

  // 1. Set demo timer in users table
  const { error: updateError } = await (adminSupabase as any)
    .from('users')
    .update({
      demo_start_at: now.toISOString(),
      demo_expires_at: expiresAt.toISOString(),
      portfolio_mode: 'demo',
    })
    .eq('id', authUser.id);

  if (updateError) {
    console.error('[demo/start] users update error:', updateError);
    return NextResponse.json(
      { error: 'Failed to start demo' },
      { status: 500 },
    );
  }

  // 2. Read user's investor style for seeding
  const { data: userData } = await (adminSupabase as any)
    .from('users')
    .select('investor_style, first_name')
    .eq('id', authUser.id)
    .single();

  const investmentStyle = userData?.investor_style || 'lynch';

  // 3. Seed style-specific starter positions + demo_portfolio_state
  try {
    await seedDemoPortfolio(authUser.id, investmentStyle);
    console.log('[demo/start] portfolio seeded ✅');
  } catch (seedErr) {
    console.error('[demo/start] SEED FAILED:', seedErr);
    // Retry once
    try {
      await seedDemoPortfolio(authUser.id, investmentStyle);
      console.log('[demo/start] portfolio seeded on retry ✅');
    } catch (retryErr) {
      console.error('[demo/start] SEED RETRY FAILED:', retryErr);
      // Now return error — don't silently succeed
      return NextResponse.json({
        success: false,
        error: 'Portfolio seeding failed. Please try again.',
        demo_start_at: now.toISOString(),
        demo_expires_at: expiresAt.toISOString(),
      }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    demo_start_at: now.toISOString(),
    demo_expires_at: expiresAt.toISOString(),
  });
}
