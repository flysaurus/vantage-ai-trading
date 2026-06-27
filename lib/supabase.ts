// ─── Supabase Client Setup ────────────────────────────────────
// Browser: @supabase/supabase-js with localStorage → manual cookie sync after login.
// Server API routes read cookies via lib/auth/get-server-user.ts.
//
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// NEVER import createServerClient in client components.

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// ─── Browser Client ──────────────────────────────────────────
// Uses @supabase/supabase-js with localStorage for session persistence.
// The session is synced to a cookie after login so the server can read it
// (via lib/auth/get-server-user.ts). This bridge is needed because
// @supabase/ssr createBrowserClient cookies are inconsistent on Vercel.

const STORAGE_KEY = 'vantage-auth-token';

function localStorageAdapter() {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return {
    getItem: (key: string) => {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    setItem: (key: string, value: string) => {
      try { window.localStorage.setItem(key, value); } catch {}
    },
    removeItem: (key: string) => {
      try { window.localStorage.removeItem(key); } catch {}
    },
  };
}

export function createClient(): SupabaseClient<Database> {
  if (typeof window === 'undefined') {
    throw new Error(
      'createClient() must only be called in the browser. ' +
      'Use createServerClient() for server-side operations.'
    );
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: localStorageAdapter(),
        storageKey: STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    }
  );
}

// ─── Cookie Sync ─────────────────────────────────────────────
// Sync the Supabase session to a cookie so the server can read it.
// Call this after signInWithPassword/signUp/signInWithOAuth success.
// The server reads this cookie in lib/auth/get-server-user.ts.

export async function syncSessionToCookie(supabase: SupabaseClient<Database>) {
  if (typeof window === 'undefined') return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      // Max-Age: 400 days, matches Supabase default
      document.cookie = `sb-auth-token=${session.access_token}; path=/; max-age=34560000; sameSite=lax`;
    }
  } catch {
    // Silently fail — worst case, server uses fallback path
  }
}

// ─── Server Auth Verification Client ────────────────────────
// Uses the ANON key (not service_role) to verify user JWTs.
// This is the correct key for auth.getUser(token) calls.

let _authClient: SupabaseClient<Database> | null = null;

export function createAuthClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error('createAuthClient() must only be called server-side.');
  }

  if (_authClient) return _authClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables.');
  }

  _authClient = createSupabaseClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _authClient;
}

// ─── Server Client ───────────────────────────────────────────
// Uses service_role key. ONLY for server-side: API routes,
// server components, RPC calls, vault operations.
// SERVICE_ROLE bypasses RLS — treat with extreme caution.

let _serverClient: SupabaseClient<Database> | null = null;

export function createServerClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error(
      'createServerClient() must only be called server-side. ' +
      'The service_role key must never reach the browser.'
    );
  }

  if (_serverClient) return _serverClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
    );
  }

  _serverClient = createSupabaseClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _serverClient;
}
