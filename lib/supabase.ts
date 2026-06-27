// ─── Supabase Client Setup ────────────────────────────────────
// Browser: @supabase/ssr createBrowserClient → HTTP-only cookie auth.
// Server API routes read cookies via lib/auth/get-server-user.ts.
//
// NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.
// NEVER import createServerClient in client components.

import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// ─── Browser Client ──────────────────────────────────────────
// Uses @supabase/ssr createBrowserClient → session stored in cookies.
// Server reads those cookies via createServerClient in lib/auth/get-server-user.ts.
// This replaces the old localStorage-based auth (vantage-auth-token).

export function createClient(): SupabaseClient<Database> {
  if (typeof window === 'undefined') {
    throw new Error(
      'createClient() must only be called in the browser. ' +
      'Use createServerClient() for server-side operations.'
    );
  }

  // Use @supabase/ssr browser client for cookie-based session sync.
  // Session token stored as HTTP cookie — server reads it automatically.
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
