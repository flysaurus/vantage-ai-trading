// ─── Supabase Browser Client ──────────────────────────────────
// SessionStorage-based client matching createClient() from lib/supabase.ts.
// Both use the same 'vantage-auth-token' key → sessions set by login/signup
// are visible to useAppState on the main page.
//
// Uses @supabase/ssr's createBrowserClient for SSR cookie handling,
// but overrides auth storage to use sessionStorage (matching login page).

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let _browserClient: SupabaseClient<Database> | null = null;

/** SessionStorage adapter matching createClient() in lib/supabase.ts */
function sessionStorageAdapter(): Storage {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      get length() { return 0; },
      key: () => null,
    };
  }
  return {
    getItem: (key: string) => sessionStorage.getItem(key),
    setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
    removeItem: (key: string) => sessionStorage.removeItem(key),
    clear: () => {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k?.startsWith('vantage')) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
    },
    get length() { return sessionStorage.length; },
    key: (index: number) => sessionStorage.key(index),
  };
}

/**
 * Singleton Supabase browser client.
 *
 * Uses @supabase/ssr's createBrowserClient for automatic
 * cookie handling, but overrides auth storage to use
 * sessionStorage (key: 'vantage-auth-token') — the same
 * storage used by createClient() in lib/supabase.ts.
 *
 * This ensures sessions created during login/signup
 * are visible to useAppState on the main page.
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

  _browserClient = createBrowserClient<Database>(url, key, {
    auth: {
      storageKey: 'vantage-auth-token',
      storage: sessionStorageAdapter(),
      autoRefreshToken: true,
      persistSession: true,
    },
  });

  return _browserClient;
}

/**
 * Resets the cached client instance.
 */
export function resetBrowserClient(): void {
  _browserClient = null;
}
