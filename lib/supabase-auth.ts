// ─── Supabase Auth Helpers ───────────────────────────────────
// Browser-side Supabase queries for user operations.
// Talks directly to Supabase — no REST API middleman.
// Relies on Supabase Auth session for authentication.
// createClient() throws during SSR — these must only run client-side.

import { createClient } from '@/lib/supabase';

/** Result shape from the users table (raw DB column names). */
interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  investor_style: string;
  investor_style_set_at: string | null;
  investor_style_onboarded: boolean;
  api_provider: string;
  status: string;
  preferences: Record<string, unknown> | null;
  auth_provider: string;
  last_login: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Cleaned-up user profile for app consumption. */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  investorStyle: string;
  investorStyleOnboarded: boolean;
  investorStyleSetAt: string | null;
  apiProvider: string;
  status: string;
  preferences: Record<string, unknown>;
  authProvider: string;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Load full user data from the users table.
 * Returns null if user doesn't exist in the table.
 */
export async function getUserData(userId: string): Promise<UserProfile | null> {
  if (!userId) {
    console.warn('[supabase-auth] getUserData: no userId');
    return null;
  }

  const supabase = createClient();
  const db = supabase as any; // dynamic columns not in generated types

  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No row found — user authenticated with Supabase Auth but has no DB record
      console.warn('[supabase-auth] User not in users table:', userId);
      return null;
    }
    console.error('[supabase-auth] getUserData query error:', error.message, error.code);
    throw error;
  }

  if (!data) return null;

  const row = data as unknown as UserRow;

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    investorStyle: row.investor_style || 'buffett',
    investorStyleOnboarded: row.investor_style_onboarded === true,
    investorStyleSetAt: row.investor_style_set_at,
    apiProvider: row.api_provider || 'alpaca',
    status: row.status || 'active',
    preferences: row.preferences || {},
    authProvider: row.auth_provider || 'email',
    lastLogin: row.last_login,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create or update a user record after Supabase Auth login.
 * - If user exists: updates last_login and updated_at
 * - If user doesn't exist: creates new row
 */
export async function createOrUpdateUserRecord(authUser: {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): Promise<{ created: boolean }> {
  if (!authUser?.id || !authUser?.email) {
    throw new Error('[supabase-auth] Invalid auth user data');
  }

  const supabase = createClient();
  const db = supabase as any; // dynamic columns not in generated types

  // Check if user already exists
  const { data: existing, error: fetchError } = await db
    .from('users')
    .select('id')
    .eq('id', authUser.id)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    throw new Error(
      `[supabase-auth] Database error checking user: ${fetchError.message}`
    );
  }

  if (existing) {
    // Update last_login
    const now = new Date().toISOString();
    const { error: updateError } = await db
      .from('users')
      .update({ last_login: now, updated_at: now })
      .eq('id', authUser.id);

    if (updateError) {
      throw new Error(`[supabase-auth] Update failed: ${updateError.message}`);
    }

    console.log('[supabase-auth] ✅ User updated:', authUser.id);
    return { created: false };
  }

  // Create new user record
  const now = new Date().toISOString();
  const provider = (authUser.app_metadata as any)?.provider || 'email';

  const { error: createError } = await db.from('users').insert({
    id: authUser.id,
    email: authUser.email,
    display_name: (authUser.user_metadata as any)?.name || null,
    avatar_url: (authUser.user_metadata as any)?.picture || null,
    auth_provider: provider,
    investor_style: 'buffett',
    investor_style_onboarded: false,
    api_provider: 'alpaca',
    status: 'active',
    last_login: now,
    created_at: now,
    updated_at: now,
  });

  if (createError) {
    throw new Error(`[supabase-auth] Create failed: ${createError.message}`);
  }

  console.log('[supabase-auth] ✅ User created:', authUser.id);
  return { created: true };
}

/**
 * Verify a user exists and is active. Fast check — only selects id + status.
 * Returns true if user exists and status is 'active'.
 */
export async function verifyUserExists(userId: string): Promise<boolean> {
  if (!userId) return false;

  const supabase = createClient();
  const db = supabase as any;

  const { data, error } = await db
    .from('users')
    .select('id, status')
    .eq('id', userId)
    .eq('status', 'active')
    .single();

  if (error || !data) {
    console.warn('[supabase-auth] User verification failed:', error?.message || 'no data');
    return false;
  }

  return true;
}

/**
 * Update user investor style and set onboarded flag.
 */
export async function updateInvestorStyle(
  userId: string,
  style: string,
  onboarded: boolean = true,
): Promise<void> {
  if (!userId) throw new Error('[supabase-auth] updateInvestorStyle: no userId');

  const supabase = createClient();
  const db = supabase as any;

  const { error } = await db
    .from('users')
    .update({
      investor_style: style,
      investor_style_set_at: new Date().toISOString(),
      investor_style_onboarded: onboarded,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    throw new Error(`[supabase-auth] Update investor style failed: ${error.message}`);
  }

  console.log('[supabase-auth] ✅ Investor style updated:', style);
}
