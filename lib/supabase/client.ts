// ─── Supabase Browser Client ──────────────────────────────────
// Client-side Supabase client. Uses anon key.
// Session stored in sessionStorage by Supabase SDK.
// Import this in client components instead of @supabase/supabase-js directly.

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// Singleton — created once per page load
let _client: ReturnType<typeof createClient<Database>> | null = null;

export const supabase = (() => {
  if (typeof window === 'undefined') {
    // SSR guard — return a dummy that logs errors if used server-side
    return new Proxy({} as ReturnType<typeof createClient<Database>>, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined;
        return () => {
          throw new Error('supabase client (lib/supabase/client) must only be used in the browser. Use createServerClient from @supabase/ssr for server-side.');
        };
      },
    });
  }

  if (_client) return _client;

  _client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storageKey: 'vantage-auth-token',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    }
  );

  return _client;
})();
