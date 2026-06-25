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
 * Creates the auth user, writes user_profiles row, seeds demo portfolio.
 * All-or-nothing: if profile insert fails, the auth user is cleaned up.
 *
 * Returns { success: true, userId } on success.
 * Returns { success: false, error: "message" } on failure.
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
      email_confirm: true, // auto-confirm — no email verification needed
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

  // ── Step 2: Write user_profiles ────────────────────────────
  const { error: profileError } = await (supabase
    .from('user_profiles') as any)
    .insert({
      id: userId,
      first_name: data.firstName,
      last_name: data.lastName,
      investor_style: data.investorStyle,
      risk_tolerance: data.riskTolerance,
      tier: 'demo',
      first_open: new Date().toISOString(),
      demo_expires_at: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

  if (profileError) {
    console.error('[createAccount] user_profiles insert failed:', profileError.message);

    // Cleanup: delete the auth user we just created
    try {
      await supabase.auth.admin.deleteUser(userId);
    } catch (cleanupErr) {
      console.error('[createAccount] cleanup failed:', cleanupErr);
    }

    return {
      success: false,
      error: 'Account setup failed. Please try again.',
    };
  }

  // ── Step 3: Seed demo portfolio ────────────────────────────
  try {
    await seedDemoPortfolio(userId, data.investorStyle);
  } catch (seedErr) {
    // Non-fatal — log and continue
    console.error('[createAccount] seedDemoPortfolio failed:', seedErr);
  }

  return { success: true, userId };
}
