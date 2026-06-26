// ─── POST /api/auth/complete-profile ─────────────────────────
// Writes user_profiles for OAuth users after Google sign-up.
// Uses service_role — only callable from server-side or trusted
// client contexts (the OAuth complete page).
//
// Also creates the public.users row (parent of user_profiles FK).
// user_profiles has NO user_id or email columns — uses id as PK + FK.

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

    // Check if users row exists (parent table)
    const { data: existingUser } = await (supabase
      .from('users') as any)
      .select('id, email')
      .eq('id', userId)
      .maybeSingle();

    if (!existingUser) {
      // For OAuth users, get email from auth
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      const email = authUser?.user?.email || '';

      const { error: userError } = await (supabase
        .from('users') as any)
        .insert({
          id: userId,
          email,
          first_name: firstName,
          last_name: lastName,
        });

      if (userError) {
        console.error('[complete-profile] users insert failed:', userError.message);
        return NextResponse.json(
          { error: 'Failed to create user record' },
          { status: 500 },
        );
      }
    }

    // Check if profile already exists
    const { data: existing } = await (supabase
      .from('user_profiles') as any)
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existing) {
      const now = new Date().toISOString();
      const demoExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error: profileError } = await (supabase
        .from('user_profiles') as any)
        .insert({
          id: userId,
          first_name: firstName,
          last_name: lastName,
          investor_style: investorStyle,
          risk_tolerance: riskTolerance,
          tier: 'demo',
          first_open: now,
          demo_expires_at: demoExpiry,
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
