// ─── Supabase Client Setup ────────────────────────────────────
// Token-based auth — browser client uses anon key, server client
// uses service_role key for privileged operations (vault, RPC).
//
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// NEVER import createServerClient in client components.

import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// ─── Browser Client ──────────────────────────────────────────
// Uses NEXT_PUBLIC anon key. Safe to use everywhere.
// Session tokens are sent via Authorization header, NOT cookies.

export function createClient(): SupabaseClient<Database> {
  if (typeof window === 'undefined') {
    throw new Error(
      'createClient() must only be called in the browser. ' +
      'Use createServerClient() for server-side operations.'
    );
  }

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storageKey: 'vantage-auth-token',
        // Use sessionStorage for token storage (cleared on tab close)
        // We manage tokens manually — Supabase's built-in cookie storage is disabled
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );
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
