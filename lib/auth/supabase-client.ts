// ─── Supabase Browser Client (Singleton) ──────────────────────
// Cookie-based browser client using @supabase/ssr createBrowserClient.
// Sessions are stored in cookies — server can read them via createServerClient.
//
// SINGLETON: always returns the same client instance. This is critical
// because createBrowserClient caches auth state internally. Multiple
// instances would have stale/divergent session state.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let _browserClient: SupabaseClient<Database> | null = null;

/**
 * Singleton Supabase browser client using cookie-based auth.
 *
 * Uses @supabase/ssr createBrowserClient which:
 * - Stores session in browser cookies (not localStorage)
 * - Server can read these cookies via createServerClient
 * - Requires middleware.ts for session refresh on Vercel
 *
 * IMPORTANT: Always use this singleton. Never create separate
 * browser clients in individual components.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (_browserClient) return _browserClient;

  // SSR guard — return a placeholder during SSR (never actually used
  // because all callers are client components or useEffect callbacks)
  if (typeof window === 'undefined') {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
    ) as SupabaseClient<Database>;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.',
    );
  }

  _browserClient = createBrowserClient<Database>(url, key);

  return _browserClient;
}

/**
 * Resets the cached client instance (e.g., after sign-out).
 */
export function resetBrowserClient(): void {
  _browserClient = null;
}
