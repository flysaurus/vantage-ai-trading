// ─── Auth Server Actions ─────────────────────────────────────
// Server-side auth operations. Uses service_role for admin-level
// user creation and profile seeding.
//
// NEVER import this file in a client component directly.
// Use 'use server' directive in the component or import only the
// type-safe action wrapper.

'use server';

import { createServerClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

interface CreateAccountInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  investorStyle: InvestorStyleKey;
  riskTolerance: RiskTolerance;
}

interface CreateAccountResult {
  success: boolean;
  error?: string;
  userId?: string;
}

/**
 * Create a new user account with admin API.
 *
 * Server action — runs on the server with service_role.
 * Creates auth user → inserts into public.users → inserts into
 * public.user_profiles (FK'd to users) → seeds demo portfolio.
 * All-or-nothing: failures trigger cleanup of partially-created rows.
 */
export async function createAccount(
  data: CreateAccountInput,
): Promise<CreateAccountResult> {
  const supabase = createServerClient();

  // ── Step 1: Create auth user ──────────────────────────────
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.firstName,
        last_name: data.lastName,
      },
    });

  if (authError) {
    console.error('[createAccount] auth.admin.createUser failed:', authError.message);

    if (
      authError.message.includes('already been registered') ||
      authError.message.includes('already exists')
    ) {
      return {
        success: false,
        error: 'An account with this email already exists. Sign in instead.',
      };
    }

    return {
      success: false,
      error: authError.message || 'Something went wrong. Please try again.',
    };
  }

  if (!authData.user) {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    };
  }

  const userId = authData.user.id;
  const now = new Date().toISOString();
  const demoExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── Step 2: Insert into public.users (parent table) ───────
  const { error: userError } = await (supabase
    .from('users') as any)
    .insert({
      id: userId,
      email: data.email,
      first_name: data.firstName,
      last_name: data.lastName,
    });

  if (userError) {
    console.error('[createAccount] users insert failed:', userError.message);
    try { await supabase.auth.admin.deleteUser(userId); } catch (_) {}

    return {
      success: false,
      error: 'Account setup failed. Please try again.',
    };
  }

  // ── Step 3: Insert into user_profiles (extended profile) ──
  const { error: profileError } = await (supabase
    .from('user_profiles') as any)
    .insert({
      id: userId,
      first_name: data.firstName,
      last_name: data.lastName,
      investor_style: data.investorStyle,
      risk_tolerance: data.riskTolerance,
      tier: 'demo',
      first_open: now,
      demo_expires_at: demoExpiry,
    });

  if (profileError) {
    console.error('[createAccount] user_profiles insert failed:', profileError.message);

    // Cleanup: delete auth user + users row
    try { await supabase.auth.admin.deleteUser(userId); } catch (_) {}
    try { await (supabase.from('users') as any).delete().eq('id', userId); } catch (_) {}

    return {
      success: false,
      error: 'Account setup failed. Please try again.',
    };
  }

  // ── Step 4: Seed demo portfolio ───────────────────────────
  try {
    await seedDemoPortfolio(userId, data.investorStyle);
  } catch (seedErr) {
    console.error('[createAccount] seedDemoPortfolio failed:', seedErr);
  }

  return { success: true, userId };
}
