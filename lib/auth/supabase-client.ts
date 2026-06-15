// ─── Supabase Browser Client ──────────────────────────────────
// Magic link auth browser client using @supabase/ssr.
// Handles cookie-based session persistence for Supabase Auth SDK.
//
// The existing custom auth system (lib/supabase.ts, lib/auth.ts)
// continues to handle email/password login, session cookies,
// and inactivity timers. This file adds Supabase-native auth
// (magic link) alongside it.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let _browserClient: SupabaseClient<Database> | null = null;

/**
 * Singleton Supabase browser client for client components.
 *
 * Uses @supabase/ssr's createBrowserClient for automatic
 * cookie handling — the Supabase session is stored in a cookie
 * managed by the SSR helpers.
 *
 * Returns the same instance on subsequent calls.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (_browserClient) return _browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    );
  }

  _browserClient = createBrowserClient<Database>(url, key);

  return _browserClient;
}

/**
 * Resets the cached client instance.
 * Used in tests or when environment variables change at runtime.
 */
export function resetBrowserClient(): void {
  _browserClient = null;
}
