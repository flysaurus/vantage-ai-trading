// ─── Token-Based Auth System ──────────────────────────────────
// Stores session token in sessionStorage (not localStorage — cleared
// on tab close). Sends via Authorization header. No cookies.
//
// Key design decisions:
// - sessionStorage > localStorage: tokens survive refreshes but not
//   tab closes, reducing exposure.
// - Authorization header: works reliably in serverless (unlike cookies
//   which had issues in V1's NextAuth setup).
// - No middleware bypass: every API route explicitly checks auth.

import { createClient, createServerClient } from './supabase';
import type { User, VantageSession, InvestorStyle } from '@/types';

const SESSION_KEY = 'vantage-session';
const USER_KEY = 'vantage-user';

// ─── Helpers ──────────────────────────────────────────────────

/** Read onboarding + style from localStorage (persists across sessions). */
function getLocalOnboarding(): { onboarded: boolean; style: InvestorStyle } {
  if (typeof window === 'undefined') return { onboarded: false, style: 'buffett' };
  try {
    return {
      onboarded: localStorage.getItem('vantage:onboarded') === 'true',
      style: (localStorage.getItem('vantage:investorStyle') as InvestorStyle) || 'buffett',
    };
  } catch {
    return { onboarded: false, style: 'buffett' };
  }
}

function buildUser(
  su: { id: string; email?: string | null; created_at: string; user_metadata?: Record<string, unknown> },
  email: string,
  displayName?: string
): User {
  const local = getLocalOnboarding();
  return {
    id: su.id,
    email: su.email || email,
    displayName: displayName || (su.user_metadata as any)?.display_name || email.split('@')[0],
    avatarUrl: (su.user_metadata as any)?.avatar_url,
    // Priority: Supabase metadata → localStorage → default
    investorStyle: ((su.user_metadata as any)?.investor_style as InvestorStyle) || local.style || 'buffett',
    investorStyleSetAt: undefined,
    // Priority: Supabase onboarded flag → localStorage → false
    investorStyleOnboarded: !!(su.user_metadata as any)?.investor_style_onboarded || local.onboarded,
    createdAt: su.created_at,
  };
}

function placerUser(email: string, displayName?: string): User {
  const local = getLocalOnboarding();
  return {
    id: '',
    email,
    displayName: displayName || email.split('@')[0],
    investorStyle: local.style || 'buffett',
    investorStyleSetAt: undefined,
    investorStyleOnboarded: local.onboarded,
    createdAt: '',
  };
}

// ─── Sign In ──────────────────────────────────────────────────

export async function signIn(
  email: string,
  password: string
): Promise<{ user: User; session: VantageSession }> {
  let supabase;
  try {
    supabase = createClient();
  } catch (e: any) {
    console.error('[auth.signIn] createClient failed:', e);
    throw new Error('Auth client initialization failed. Please refresh the page.');
  }

  let data, error;
  try {
    const result = await supabase.auth.signInWithPassword({ email, password });
    data = result.data;
    error = result.error;
  } catch (e: any) {
    console.error('[auth.signIn] Supabase call failed:', e);
    throw new Error(String(e?.message || e?.toString() || 'Network error connecting to auth server.'));
  }

  if (error) {
    console.error('[auth.signIn] Supabase returned error:', error.message, error.status);
    throw new Error(String(error.message || 'Authentication failed'));
  }

  if (!data?.user || !data?.session) {
    console.error('[auth.signIn] Missing user/session in response:', { hasUser: !!data?.user, hasSession: !!data?.session });
    throw new Error('Sign in failed — server returned incomplete response.');
  }

  console.log('[auth.signIn] Success:', { userId: data.user.id, email: data.user.email });

  const user: User = buildUser(data.user, email, undefined);

  const session: VantageSession = {
    token: data.session.access_token,
    expiresAt: data.session.expires_at || Math.floor(Date.now() / 1000) + 3600,
    userId: data.user.id,
  };

  // Store in sessionStorage
  storeSession(session);

  return { user, session };
}

// ─── Sign Up ──────────────────────────────────────────────────

export async function signUp(
  email: string,
  password: string,
  displayName?: string
): Promise<{ user: User; session: VantageSession | null; needsConfirmation: boolean }> {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || email.split('@')[0],
      },
    },
  });

  if (error) {
    // User already exists (from a previous signup attempt) —
    // treat as "needs confirmation" instead of an error
    const errMsg = String(error.message || '').toLowerCase();
    if (errMsg.includes('already registered') ||
        errMsg.includes('already exists') ||
        errMsg.includes('already signed up') ||
        error.status === 422) {
      // Account already exists — tell user to sign in, don't pretend to send email
      throw new Error('An account with this email already exists. Please sign in instead.');
    }
    throw new Error(String(error.message || 'Authentication failed'));
  }

  // Some Supabase configurations return null user/session on signUp
  // when email confirmation is enabled — user IS created, just not returned.
  // Treat this as needsConfirmation rather than an error.
  if (!data.user) {
    return {
      user: placerUser(email, displayName),
      session: null,
      needsConfirmation: true,
    };
  }

  // Email confirmation required — user created but no session yet
  if (!data.session) {
    return {
      user: buildUser(data.user, email, displayName),
      session: null,
      needsConfirmation: true,
    };
  }

  // Auto-confirmed — session available immediately
  const user: User = buildUser(data.user, email, displayName);

  const session: VantageSession = {
    token: data.session.access_token,
    expiresAt: data.session.expires_at || Math.floor(Date.now() / 1000) + 3600,
    userId: data.user.id,
  };

  storeSession(session);

  return { user, session, needsConfirmation: false };
}

// ─── Resend Confirmation ──────────────────────────────────────

export async function resendConfirmation(
  email: string
): Promise<{ success: boolean; message: string }> {
  const supabase = createClient();

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
  });

  if (error) {
    const errMsg = String(error.message || '');
    if (errMsg.includes('rate limit') || error.status === 429) {
      return { success: false, message: 'Please wait before requesting another email.' };
    }
    if (errMsg.includes('already confirmed') || errMsg.includes('already verified')) {
      return { success: false, message: 'Email is already verified. Please sign in.' };
    }
    return { success: false, message: 'Unable to resend. Please try again later.' };
  }

  return { success: true, message: 'Verification email resent. Check your inbox!' };
}

// ─── Sign Out ─────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.auth.signOut();
  } catch {
    // Best-effort server-side sign out — token will expire anyway
  } finally {
    clearSession();
  }
}

// ─── Session Management ───────────────────────────────────────

export function getSession(): VantageSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    const session: VantageSession = JSON.parse(raw);

    // Check expiry
    if (session.expiresAt && session.expiresAt < Math.floor(Date.now() / 1000)) {
      clearSession();
      return null;
    }

    return session;
  } catch {
    clearSession();
    return null;
  }
}

export function storeSession(session: VantageSession): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    console.error('[Auth] Failed to store session in sessionStorage');
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore
  }
}

// ─── User Storage (avoids blocking API call on mount) ────────

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function storeUser(user: User): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    console.error('[Auth] Failed to store user in sessionStorage');
  }
}

export function clearUser(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(USER_KEY);
  } catch {
    // Ignore
  }
}

// ─── Token Refresh ────────────────────────────────────────────

export async function refreshSession(): Promise<VantageSession | null> {
  const current = getSession();
  if (!current) return null;

  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.refreshSession();

    if (error || !data.session) {
      clearSession();
      return null;
    }

    const session: VantageSession = {
      token: data.session.access_token,
      expiresAt: data.session.expires_at || Math.floor(Date.now() / 1000) + 3600,
      userId: data.session.user.id,
    };

    storeSession(session);
    return session;
  } catch {
    clearSession();
    return null;
  }
}

// ─── API Route Middleware ─────────────────────────────────────

/**
 * Validates a session token from an Authorization header.
 * For use in API route handlers.
 *
 * Usage:
 *   const { userId } = await requireAuth(request);
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
    // Verify the token with Supabase — use anon key client for auth
    // (service_role bypasses JWT verification; anon key validates properly)
    const { createAuthClient } = await import('@/lib/supabase');
    const supabase = createAuthClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new AuthError('Invalid or expired token', 401);
    }

    return { userId: data.user.id, token };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Authentication failed', 401);
  }
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
