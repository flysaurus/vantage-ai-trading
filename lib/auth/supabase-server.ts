// ─── Supabase Server Client ──────────────────────────────────
// Server-side Supabase client using @supabase/ssr.
// Reads cookies from next/headers for session persistence.
//
// Use this for:
//   - Route handlers (app/api/...)
//   - Server components
//   - Auth callbacks
//
// For ADMIN operations bypassing RLS (vault, bulk migrations),
// use createServerClient() from lib/supabase.ts instead.

import { createServerClient as createSSRServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

let _serverClient: SupabaseClient<Database> | null = null;

/**
 * Server-side Supabase client.
 *
 * Uses @supabase/ssr's createServerClient with cookie handling
 * from next/headers. Session is read from cookies automatically,
 * so auth.getUser() works without passing tokens manually.
 *
 * Uses the ANON key — safe for server-side auth verification.
 * For service_role operations, use createServerClient() from
 * lib/supabase.ts instead.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  // Don't cache across requests — each request may have different cookies
  // Re-create per invocation to pick up current cookie store

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    );
  }

  const cookieStore = await cookies();

  return createSSRServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (err: any) {
          // Log instead of silently swallowing — this is critical for auth flow
          console.error('[supabase-server] setAll failed:', err.message);
        }
      },
    },
  });
}
