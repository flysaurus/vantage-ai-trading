// ─── Auth Utilities (Supabase Auth) ────────────────────────────
// Session managed by Supabase SDK (autoRefreshToken, persistSession).
// This file provides: user profile cache for client-side use.
//
// NOTE: Server-side auth is in lib/auth/get-server-user.ts (cookie-based).
//       Client-side API calls use lib/api-client.ts (credentials: 'include').

// ─── User Profile Cache (localStorage — persists across sessions) ────

const USER_KEY = 'vantage-user';

export function getUser(): any | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: any): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
}

export function clearUser(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
}
