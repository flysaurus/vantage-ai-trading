// ─── Anonymous Session ──────────────────────────────────────
// UUID-based anonymous session that persists across browser
// sessions via localStorage. Used for demo/trial mode before
// a user authenticates with magic link or email/password.
//
// Storage keys:
//   vantage_anonymous_id   → UUID (persists indefinitely)
//   vantage_first_open     → ISO timestamp (set once, never reset)

const ANON_ID_KEY = 'vantage_anonymous_id';
const FIRST_OPEN_KEY = 'vantage_first_open';

// ─── Anonymous ID ────────────────────────────────────────────

/**
 * Get or create the anonymous session UUID.
 *
 * Persists across page refreshes and browser close/reopen.
 * Uses crypto.randomUUID() for generation — cryptographically
 * random, no external dependencies.
 *
 * This ID is sent with all anonymous Supabase writes so data
 * can be migrated when the user signs up via magic link.
 */
export function getOrCreateAnonymousId(): string {
  if (typeof window === 'undefined') {
    // SSR fallback — generate a one-off UUID that won't be stored.
    // The client will pick up the real persisted ID on mount.
    return crypto.randomUUID();
  }

  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;

    const uuid = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, uuid);
    console.log('[anon] Created new anonymous ID:', uuid.slice(0, 8) + '...');
    return uuid;
  } catch {
    // localStorage unavailable (private browsing, quota exceeded)
    // Fall back to in-memory UUID — won't survive refresh but won't crash
    return crypto.randomUUID();
  }
}

// ─── First Open ──────────────────────────────────────────────

/**
 * Get the user's first open timestamp.
 * Set to now() on first call, never resets.
 * Returns a Date object.
 */
export function getFirstOpen(): Date {
  if (typeof window === 'undefined') return new Date();

  try {
    const existing = localStorage.getItem(FIRST_OPEN_KEY);
    if (existing) return new Date(existing);

    const now = new Date().toISOString();
    localStorage.setItem(FIRST_OPEN_KEY, now);
    console.log('[anon] First open recorded:', now);
    return new Date(now);
  } catch {
    return new Date();
  }
}

// ─── Demo Expiration ─────────────────────────────────────────

const DEMO_DURATION_DAYS = 30;

/**
 * Calculate when the demo period expires.
 * First open + 30 days.
 */
export function getDemoExpiresAt(): Date {
  const firstOpen = getFirstOpen();
  const expiresAt = new Date(firstOpen);
  expiresAt.setDate(expiresAt.getDate() + DEMO_DURATION_DAYS);
  return expiresAt;
}

/**
 * Get days remaining in the demo period.
 * Returns 0 if expired (never negative).
 */
export function getDaysRemaining(): number {
  const now = new Date();
  const expiresAt = getDemoExpiresAt();
  const diffMs = expiresAt.getTime() - now.getTime();
  const days = Math.ceil(diffMs / 86_400_000);
  return Math.max(0, days);
}

/**
 * Returns true if this is an anonymous session (no Supabase auth).
 * Used to determine whether to show demo-related UI.
 */
export function isAnonymousSession(): boolean {
  if (typeof window === 'undefined') return true;

  try {
    // Check for Supabase auth session via the SSR-managed cookie
    // The @supabase/ssr client stores session in cookies; we check
    // if a Supabase auth token exists in sessionStorage (vantage-auth-token
    // is the key used by lib/supabase.ts createClient)
    const token = sessionStorage.getItem('vantage-auth-token');
    if (!token) return true;

    // Parse the stored token to check if it has a valid session
    try {
      const parsed = JSON.parse(token);
      return !parsed?.access_token;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

// ─── Reset (for testing / logout) ────────────────────────────

/**
 * Clear all anonymous session data from localStorage.
 * Called on explicit logout or when user authenticates.
 */
export function clearAnonymousSession(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(ANON_ID_KEY);
    localStorage.removeItem(FIRST_OPEN_KEY);
    console.log('[anon] Session cleared');
  } catch {
    // Ignore storage errors
  }
}
