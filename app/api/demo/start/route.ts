// ─── POST /api/demo/start — Initialize 30-day demo ─────────
// Called when user taps "Start my 30-day demo" CTA.
// Sets demo_start_at, demo_expires_at, portfolio_mode.
// Resets demo portfolio to $100,000 cash (clears all positions).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  // Try access_token first, fall back to cookie auth
  let userId: string | undefined;

  try {
    const body = await req.json().catch(() => ({})) as { access_token?: string };

    if (body.access_token) {
      const { data: { user }, error: verifyError } = await createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ).auth.getUser(body.access_token);

      if (verifyError || !user) {
        return NextResponse.json(
          { error: 'Invalid access token' },
          { status: 401 },
        );
      }
      userId = user.id;
    } else {
      const { authUser, authError } = await requireAuth();
      if (authError) return authError;
      userId = authUser.id;
    }
  } catch {
    const { authUser, authError } = await requireAuth();
    if (authError) return authError;
    userId = authUser.id;
  }

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
    // Guard: should never happen, but satisfy TypeScript
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 },
      );
    }

    // 1. Set demo timer in users table (match by UUID, not email —
    //    Supabase Auth lowercases emails which can mismatch the users.email column)
    const { error: userError } = await supabase
      .from('users')
      .update({
        demo_start_at: now.toISOString(),
        demo_expires_at: expiresAt.toISOString(),
        portfolio_mode: 'demo',
      })
      .eq('id', userId);

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
        .eq('user_id', userId);

      // Set fresh cash-only state
      const { error: insertError } = await supabase
        .from('demo_portfolio_state')
        .upsert({
          user_id: userId,
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
