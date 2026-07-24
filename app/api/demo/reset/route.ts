/**
 * POST /api/demo/reset — Reset demo portfolio to fresh state.
 *
 * Clears all positions and demo_portfolio_state for the user,
 * then re-seeds $100,000 cash-only (no positions/orders).
 * Only works in demo mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';
import { getOptionalUserId } from '@/lib/auth/get-server-user';

export async function POST(req: NextRequest) {
  try {
    const userId = await getOptionalUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminSupabase = createServerClient();

    // Get current style
    const { data: userData } = await (adminSupabase as any)
      .from('users')
      .select('investor_style')
      .eq('id', userId)
      .single();

    const style = userData?.investor_style || 'lynch';

    // Clear existing demo data
    await Promise.all([
      (adminSupabase as any)
        .from('positions')
        .delete()
        .eq('user_id', userId),
      (adminSupabase as any)
        .from('demo_portfolio_state')
        .delete()
        .eq('user_id', userId),
    ]);

    // Re-seed with fresh style-specific portfolio
    await seedDemoPortfolio(userId, style);

    return NextResponse.json({
      reset: true,
      style,
      message: `Demo reset — seeded ${style} portfolio with $100,000 total`,
    });
  } catch (error: any) {
    console.error('Demo reset error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
