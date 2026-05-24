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
import type { User, VantageSession } from '@/types';

const SESSION_KEY = 'vantage-session';
const USER_KEY = 'vantage-user';

// ─── Sign In ──────────────────────────────────────────────────

export async function signIn(
  email: string,
  password: string
): Promise<{ user: User; session: VantageSession }> {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user || !data.session) {
    throw new Error('Sign in failed — no user or session returned');
  }

  const user: User = {
    id: data.user.id,
    email: data.user.email || email,
    displayName: data.user.user_metadata?.display_name || email.split('@')[0],
    avatarUrl: data.user.user_metadata?.avatar_url,
    createdAt: data.user.created_at,
  };

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
    if (error.message?.toLowerCase().includes('already registered') ||
        error.message?.toLowerCase().includes('already exists') ||
        error.message?.toLowerCase().includes('already signed up') ||
        error.status === 422) {
      return {
        user: { id: '', email, displayName: displayName || email.split('@')[0], createdAt: '' },
        session: null,
        needsConfirmation: true,
      };
    }
    throw new Error(error.message);
  }

  // Some Supabase configurations return null user/session on signUp
  // when email confirmation is enabled — user IS created, just not returned.
  // Treat this as needsConfirmation rather than an error.
  if (!data.user) {
    return {
      user: { id: '', email, displayName: displayName || email.split('@')[0], createdAt: '' },
      session: null,
      needsConfirmation: true,
    };
  }

  // Email confirmation required — user created but no session yet
  if (!data.session) {
    return {
      user: {
        id: data.user.id,
        email: data.user.email || email,
        displayName: displayName || email.split('@')[0],
        avatarUrl: undefined,
        createdAt: data.user.created_at,
      },
      session: null,
      needsConfirmation: true,
    };
  }

  // Auto-confirmed — session available immediately
  const user: User = {
    id: data.user.id,
    email: data.user.email || email,
    displayName: displayName || email.split('@')[0],
    avatarUrl: undefined,
    createdAt: data.user.created_at,
  };

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
    if (error.message?.includes('rate limit') || error.status === 429) {
      return { success: false, message: 'Please wait before requesting another email.' };
    }
    if (error.message?.includes('already confirmed') || error.message?.includes('already verified')) {
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
    // Verify the token with Supabase — use server client
    // since API routes run server-side
    const supabase = createServerClient();
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
