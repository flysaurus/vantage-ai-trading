// ─── Supabase Browser Client ──────────────────────────────────
// SessionStorage-based client matching createClient() from lib/supabase.ts.
//
// CRITICAL: Uses @supabase/supabase-js createClient() directly, NOT
// createBrowserClient from @supabase/ssr. The SSR library OVERRIDES
// auth.storage with cookie-based storage, which means sessions set
// during login (via sessionStorage) are invisible on the main page.
//
// Both clients now use identical setup: same library, same storageKey,
// same sessionStorage adapter → sessions are shared across all pages.

import { createClient } from '@supabase/supabase-js';
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
 * Uses @supabase/supabase-js createClient() directly (same as
 * lib/supabase.ts) with sessionStorage adapter.
 *
 * This ensures sessions created during login/signup are visible
 * to useAppState on the main page. Both clients write to the
 * same sessionStorage key: 'vantage-auth-token'.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (_browserClient) return _browserClient;

  // SSR guard — useAppState is client-only, but Next.js may call
  // during SSR for static generation. Return a dummy client that
  // will be replaced on hydration. Never actually called because
  // useAppState is wrapped in useEffect (client-only).
  if (typeof window === 'undefined') {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
      {
        auth: {
          storageKey: 'vantage-auth-token',
          storage: sessionStorageAdapter(),
          autoRefreshToken: true,
          persistSession: true,
        },
      },
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

  _browserClient = createClient<Database>(url, key, {
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
