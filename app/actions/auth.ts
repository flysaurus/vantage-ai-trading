'use server';
// ─── Server-Side Auth Actions ────────────────────────────────
// Uses Supabase Auth natively — no custom argon2/password hashing.
// Two-client pattern: anon key for auth operations, service_role for DB.
// Session managed by Supabase SDK cookies via @supabase/ssr v0.10.x (getAll/setAll).

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServerClient as createServiceClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// ─── SSR client helper (getAll/setAll API for @supabase/ssr v0.10.x) ──

async function createSSRClient(key?: string): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {}
        },
      },
    }
  );
}

// ─── Create Account ──────────────────────────────────────────

export async function createAccount(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  investorStyle: string;
  riskTolerance: string;
}): Promise<{ success: boolean; error?: string; needsVerification?: boolean }> {
  // Validate required fields
  if (!data.email || !data.password) {
    return { success: false, error: 'Email and password are required.' };
  }

  if (!data.investorStyle) {
    return { success: false, error: 'Please complete the investor style quiz before creating an account.' };
  }

  // Client 1: Anon key for public signUp operation
  const authClient = await createSSRClient();

  // Step 1: Create Supabase Auth user (handles JWT sessions, email confirmation)
  const { data: authData, error: authError } = await authClient.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        first_name: data.firstName,
        last_name: data.lastName,
        investor_style: data.investorStyle,
        risk_tolerance: data.riskTolerance,
      },
    },
  });

  if (authError) {
    console.error('[createAccount] signUp error:', authError);
    if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
      return { success: false, error: 'An account with this email already exists. Sign in instead.' };
    }
    return { success: false, error: authError.message };
  }

  if (!authData.user) {
    return { success: false, error: 'Signup failed. Please try again.' };
  }

  // Step 2: Write to public.users (service role bypasses RLS)
  // Check if user already exists first (edge case: auth account created but users write failed previously)
  const serviceDb = createServiceClient() as any;
  const { data: existingUser } = await serviceDb
    .from('users')
    .select('id')
    .eq('email', data.email)
    .single();

  if (!existingUser) {
    const { error: userError } = await serviceDb
      .from('users')
      .insert({
        id: authData.user.id,
        email: data.email,
        first_name: data.firstName,
        last_name: data.lastName,
        investor_style: data.investorStyle,
        risk_tolerance: data.riskTolerance,
        investor_style_onboarded: true,
        investor_style_set_at: new Date().toISOString(),
        tier: 'demo',
        first_open: new Date().toISOString(),
        demo_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

    if (userError) {
      console.error('[createAccount] users insert error:', userError);
      // Clean up: delete the auth user to avoid orphaned auth accounts
      try {
        const adminClient = await createSSRClient(process.env.SUPABASE_SERVICE_ROLE_KEY!);
        await adminClient.auth.admin.deleteUser(authData.user.id);
      } catch (cleanupErr) {
        console.error('[createAccount] Auth cleanup failed:', cleanupErr);
      }
      return { success: false, error: 'Account setup failed. Please try again.' };
    }
  } else {
    // Update existing row with onboarding data (edge case recovery)
    await serviceDb
      .from('users')
      .update({
        first_name: data.firstName,
        last_name: data.lastName,
        investor_style: data.investorStyle,
        risk_tolerance: data.riskTolerance,
        investor_style_onboarded: true,
        investor_style_set_at: new Date().toISOString(),
      })
      .eq('email', data.email);
  }

  // Step 3: Seed demo portfolio (best effort)
  try {
    await serviceDb.from('demo_portfolio_state').insert({
      user_id: authData.user.id,
      cash_balance: 100000,
      total_value: 100000,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[createAccount] Demo seed failed (non-fatal):', e);
  }

  return { success: true, needsVerification: false };
}

// ─── Sign In ─────────────────────────────────────────────────

export async function signIn(data: {
  email: string;
  password: string;
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createSSRClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });

  if (error) {
    return { success: false, error: 'Incorrect email or password.' };
  }

  return { success: true };
}

// ─── Sign Out ────────────────────────────────────────────────

export async function signOutAction(): Promise<{ success: boolean }> {
  const supabase = await createSSRClient();
  await supabase.auth.signOut();
  return { success: true };
}

// ─── Get Current Session ─────────────────────────────────────

export async function getCurrentSession(): Promise<{
  user: { id: string; email: string } | null;
  accessToken: string | null;
}> {
  const supabase = await createSSRClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { user: null, accessToken: null };

  const { data: sessionData } = await supabase.auth.getSession();
  return {
    user: { id: data.user.id, email: data.user.email! },
    accessToken: sessionData.session?.access_token || null,
  };
}

// ─── Get User Profile ────────────────────────────────────────

export async function getUserProfile(userId: string): Promise<{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  investorStyle: string;
  investorStyleOnboarded: boolean;
  riskTolerance: string;
  tier: string;
  demoExpiresAt: string | null;
  createdAt: string;
} | null> {
  const serviceDb = createServiceClient() as any;
  const { data, error } = await serviceDb
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    email: data.email,
    firstName: data.first_name || '',
    lastName: data.last_name || '',
    investorStyle: data.investor_style || 'buffett',
    investorStyleOnboarded: data.investor_style_onboarded ?? false,
    riskTolerance: data.risk_tolerance || 'Moderate',
    tier: data.tier || 'demo',
    demoExpiresAt: data.demo_expires_at || null,
    createdAt: data.created_at || '',
  };
}
