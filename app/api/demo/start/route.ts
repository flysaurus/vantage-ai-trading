// ─── POST /api/demo/start — Initialize 30-day demo ─────────
// Called when user taps "Start my 30-day demo" CTA.
// Sets demo_start_at, demo_expires_at, portfolio_mode.
// Resets demo portfolio to $100,000 cash (clears all positions).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const cookieStore = await cookies();

  // Use service_role for writes (needs elevated permissions)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  try {
    // 1. Set demo timer in users table
    const { error: userError } = await supabase
      .from('users')
      .update({
        demo_start_at: now.toISOString(),
        demo_expires_at: expiresAt.toISOString(),
        portfolio_mode: 'demo',
      })
      .eq('email', authUser.email);

    if (userError) {
      console.error('[demo/start] users update error:', userError);
      return NextResponse.json(
        { error: 'Failed to start demo' },
        { status: 500 }
      );
    }

    // 2. Reset demo portfolio to $100,000 cash
    // Clear existing state from demo_portfolio_state
    try {
      // Delete existing portfolio state
      await supabase
        .from('demo_portfolio_state')
        .delete()
        .eq('user_id', authUser.id);

      // Set fresh cash-only state
      const { error: insertError } = await supabase
        .from('demo_portfolio_state')
        .upsert({
          user_id: authUser.id,
          positions: [],
          cash_balance: 100000,
          orders: [],
          basket_orders: [],
          updated_at: now.toISOString(),
        }, { onConflict: 'user_id' });

      if (insertError) {
        console.warn('[demo/start] portfolio upsert warning:', insertError);
        // Non-fatal — portfolio will initialize on first load
      }
    } catch (portfolioErr) {
      console.warn('[demo/start] portfolio reset warning:', portfolioErr);
      // Non-fatal — demo broker will initialize with defaults
    }

    // 3. Clear any cached localStorage demo state on the client
    // (handled client-side after successful response)

    return NextResponse.json({
      success: true,
      demo_start_at: now.toISOString(),
      demo_expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[demo/start] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
