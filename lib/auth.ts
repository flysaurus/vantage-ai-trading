// ─── Auth Utilities (Supabase Auth) ────────────────────────────
// Session managed by Supabase SDK (autoRefreshToken, persistSession).
// This file provides: session helpers, API middleware, and profile cache.

import { createAuthClient, createServerClient } from './supabase';

// ─── Optional JWT Extraction (anonymous-friendly) ─────────────

/**
 * Extracts userId from the Authorization Bearer JWT if present.
 * Returns 'anonymous' if no valid token is found.
 * For routes that serve both authenticated and anonymous users.
 */
export async function getOptionalUserId(request: Request): Promise<string> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return 'anonymous';
  try {
    const supabase = createAuthClient();
    const { data } = await supabase.auth.getUser(authHeader.slice(7));
    return data.user?.id || 'anonymous';
  } catch {
    return 'anonymous';
  }
}

// ─── Session Helpers (browser-side, for API callers) ──────────

/** Get the Supabase access token from sessionStorage for API Bearer auth. */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('vantage-auth-token');
    return raw || null;
  } catch {
    return null;
  }
}

// ─── User Profile Cache (sessionStorage — session-scoped) ────

const USER_KEY = 'vantage-user';

export function getUser(): any | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: any): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
}

export function clearUser(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
}

// ─── Legacy Session Helpers (shims for components still importing them) ──
// These were for the old custom user_sessions table. Now they just wrap
// sessionStorage for the Supabase JWT. Safe to keep — AuthProvider calls them.

const SESSION_KEY = 'vantage-auth-token';

export function storeSession(session: any): void {
  if (typeof window === 'undefined') return;
  try {
    if (session?.access_token) {
      sessionStorage.setItem(SESSION_KEY, session.access_token);
    }
  } catch { /* ignore */ }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

// ─── API Route Middleware ─────────────────────────────────────

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Validates a Supabase JWT from the Authorization header.
 * Uses the anon key to verify the token (auth.getUser).
 */
export async function requireAuth(
  request: Request
): Promise<{ userId: string; token: string }> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  const token = authHeader.slice(7);

  try {
    const supabase = createAuthClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new AuthError('Invalid or expired session', 401);
    }

    return { userId: data.user.id, token };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Authentication failed', 401);
  }
}

/**
 * Get user profile from users table (server-side, uses service role).
 */
export async function getUserProfile(userId: string) {
  const supabase = createServerClient() as any;

  // Try user_profiles first (where createAccount writes)
  let { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  // Fall back to users table (legacy accounts)
  if (error || !data) {
    const result = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    data = result.data;
    error = result.error;
  }

  if (error || !data) return null;

  return {
    id: data.id || data.user_id || userId,
    email: data.email,
    firstName: data.first_name,
    lastName: data.last_name,
    investorStyle: data.investor_style,
    investorStyleOnboarded: data.investor_style_onboarded ?? false,
    riskTolerance: data.risk_tolerance,
    createdAt: data.created_at,
    tier: data.tier,
  };
}
