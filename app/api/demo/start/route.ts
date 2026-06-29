// ─── POST /api/demo/start — Initialize 30-day demo ─────────
// Called when user taps "Start my 30-day demo" CTA.
// Sets demo_start_at, demo_expires_at, portfolio_mode.
// Resets demo portfolio to $100,000 cash (clears all positions).
//
// Auth: cookies only (session refreshed by middleware).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
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

  // 2. Reset demo portfolio to $100,000 cash
  try {
    await (adminSupabase as any)
      .from('demo_portfolio_state')
      .delete()
      .eq('user_id', authUser.id);

    const { error: insertError } = await (adminSupabase as any)
      .from('demo_portfolio_state')
      .upsert(
        {
          user_id: authUser.id,
          positions: [],
          cash_balance: 100000,
          orders: [],
          basket_orders: [],
          updated_at: now.toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (insertError) {
      console.warn('[demo/start] portfolio upsert warning:', insertError);
    }
  } catch (portfolioErr) {
    console.warn('[demo/start] portfolio reset warning:', portfolioErr);
  }

  return NextResponse.json({
    success: true,
    demo_start_at: now.toISOString(),
    demo_expires_at: expiresAt.toISOString(),
  });
}
