// ─── POST /api/demo/start — Initialize 30-day demo ─────────
// Called when user taps "Start my 30-day demo" CTA.
// Sets demo_start_at, demo_expires_at, portfolio_mode.
// Seeds style-specific starter positions ($15K-$25K invested).
// Total account value: $100,000 (positions + cash).
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
    console.log('[demo/start] seeded portfolio for style:', investmentStyle);
  } catch (seedErr) {
    console.warn('[demo/start] seed warning (non-fatal):', seedErr);
  }

  return NextResponse.json({
    success: true,
    demo_start_at: now.toISOString(),
    demo_expires_at: expiresAt.toISOString(),
  });
}
