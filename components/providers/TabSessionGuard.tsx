// ─── TabSessionGuard — pass-through ──────────────────────────
// Previously this component force-signed-out whenever it mounted on a "fresh"
// tab that still had a Supabase session cookie. That logic was fundamentally
// broken: `sessionStorage` is per-tab and not shared across tabs, so every new
// tab (or a browser session restore) read `vantage_tab_active` as null, saw the
// still-valid session cookie, and signed the user out + redirected to `/` —
// logging them out while they were actively working.
//
// Session persistence across tabs is the expected behavior (the inactivity
// timer in `useInactivity` handles idle timeout, and the user can sign out
// explicitly from Settings). This guard is now a no-op pass-through.

'use client';

import type { ReactNode } from 'react';

export function TabSessionGuard({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
