// ─── POST /api/auth/complete-profile ─────────────────────────
// Writes user_profiles for OAuth users after Google sign-up.
// Uses service_role — only callable from server-side or trusted
// client contexts (the OAuth complete page).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, firstName, lastName, investorStyle, riskTolerance } = body;

    if (!userId || !firstName || !lastName || !investorStyle || !riskTolerance) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // Check if profile already exists
    const { data: existing } = await (supabase
      .from('user_profiles') as any)
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      // Create new profile
      const { error: profileError } = await (supabase
        .from('user_profiles') as any)
        .insert({
          id: userId,
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          investor_style: investorStyle,
          risk_tolerance: riskTolerance,
          tier: 'demo',
          first_open: new Date().toISOString(),
          demo_expires_at: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        });

      if (profileError) {
        console.error('[complete-profile] Insert failed:', profileError.message);
        return NextResponse.json(
          { error: 'Failed to create profile' },
          { status: 500 },
        );
      }

      // Seed demo portfolio
      try {
        await seedDemoPortfolio(userId, investorStyle);
      } catch (seedErr) {
        console.error('[complete-profile] Seed failed:', seedErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[complete-profile] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
