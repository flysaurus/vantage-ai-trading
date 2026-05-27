// ─── POST /api/auth/verify-user ─────────────────────────────────
// Hard block: Users MUST exist in the users table or they cannot proceed.
// Auto-create gated by TWO conditions:
//   1. Email must be confirmed in Supabase Auth (email_confirmed_at)
//   2. Auth user must have been created within the last 24 hours
//   This ensures only genuinely NEW users get auto-created on first sign-in.
//   Deleted accounts or stale auth tokens cannot recreate a DB row.
//   - User exists + active → update last_login, grant access
//   - User exists + inactive → 403 blocked
// Uses service_role key (server-side only) to bypass RLS.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify the JWT — only allow authenticated requests
    const { userId } = await requireAuth(req);

    // Parse optional email from body
    const body = await req.json().catch(() => ({}));
    const { email } = body as { email?: string };

    console.log('[verify-user] Checking user:', { userId, email });

    const supabase = createServerClient();
    const db = supabase as any;

    // Step 1: Check if user exists in users table
    const { data: existingUser, error: fetchError } = await db
      .from('users')
      .select('id, email, status, investor_style_onboarded')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('[verify-user] Database error:', fetchError);
      return NextResponse.json(
        { error: 'Database error', details: fetchError.message },
        { status: 500 }
      );
    }

    // Step 2: User NOT in users table → check email confirmation status
    if (!existingUser) {
      console.log('[verify-user] User NOT in users table — checking email confirmation...');

      // Check Supabase Auth for email confirmation status
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);

      if (authError || !authUser?.user) {
        console.error('[verify-user] Failed to fetch auth user:', authError);
        return NextResponse.json(
          { error: 'Authentication verification failed', details: authError?.message },
          { status: 500 }
        );
      }

      const isEmailConfirmed = !!authUser.user.email_confirmed_at;
      console.log('[verify-user] Email confirmed:', isEmailConfirmed,
        isEmailConfirmed ? `(at ${authUser.user.email_confirmed_at})` : '');

      if (!isEmailConfirmed) {
        // User hasn't confirmed their email yet — block access
        console.log('[verify-user] ❌ Email NOT confirmed — BLOCKED');
        return NextResponse.json(
          {
            error: 'Email not confirmed',
            details: 'Please check your inbox and confirm your email address before signing in.',
          },
          { status: 403 }
        );
      }

      // Email IS confirmed — but only auto-create for genuinely new accounts.
      // Gate: auth user must have been created within the last 24 hours.
      // This prevents old users whose DB row was deleted from auto-recreating.
      const userCreatedAt = new Date(authUser.user.created_at).getTime();
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      if (userCreatedAt < twentyFourHoursAgo) {
        console.log('[verify-user] ❌ Stale auth user (created', authUser.user.created_at, ') — BLOCKED');
        return NextResponse.json(
          { error: 'Account not found', details: 'No account data exists. Please sign up first.' },
          { status: 404 }
        );
      }

      console.log('[verify-user] ✅ Email confirmed + recent account — creating users table record...');

      const confirmedEmail = authUser.user.email || email || `${userId}@unknown`;
      const displayName = confirmedEmail.split('@')[0];
      const now = new Date().toISOString();

      const { data: newUser, error: createError } = await db
        .from('users')
        .insert({
          id: userId,
          email: confirmedEmail,
          display_name: displayName || null,
          investor_style: 'buffett',
          investor_style_onboarded: false,
          api_provider: 'alpaca',
          status: 'active',
          auth_provider: 'email',
          last_login: now,
          created_at: now,
          updated_at: now,
        })
        .select('id, email, investor_style_onboarded')
        .single();

      if (createError) {
        console.error('[verify-user] Failed to create user record:', createError);
        return NextResponse.json(
          { error: 'Failed to create user record', details: createError.message },
          { status: 500 }
        );
      }

      console.log('[verify-user] ✅ User record created after email confirmation');
      return NextResponse.json({
        success: true,
        action: 'created',
        user: {
          id: newUser.id,
          email: newUser.email,
          investorStyleOnboarded: newUser.investor_style_onboarded,
        },
      });
    }

    // Step 3: User EXISTS in users table
    console.log('[verify-user] ✅ User found in users table');

    if (existingUser.status !== 'active') {
      console.error('[verify-user] ❌ User account is not active:', existingUser.status);
      return NextResponse.json(
        { error: 'Account inactive', details: `Your account is ${existingUser.status}` },
        { status: 403 }
      );
    }

    // Update last_login
    const now = new Date().toISOString();
    await db
      .from('users')
      .update({ last_login: now, updated_at: now })
      .eq('id', userId);

    return NextResponse.json({
      success: true,
      action: 'verified',
      user: {
        id: existingUser.id,
        email: existingUser.email,
        investorStyleOnboarded: existingUser.investor_style_onboarded,
      },
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[verify-user] ❌ Server error:', err);
    return NextResponse.json(
      { error: 'Server error', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
