// ─── Auth Utilities ───────────────────────────────────────────
// Session lifecycle managed by Supabase SDK (autoRefreshToken, persistSession).
// This file provides: sync token accessors, user profile cache, and API middleware.
//
// getSession() reads a parallel sessionStorage copy synced by AuthProvider.
// Supabase SDK handles actual login/refresh/logout via onAuthStateChange.

import { createAuthClient, createServerClient } from './supabase';
import type { VantageSession, User, InvestorStyle } from '@/types';

const SESSION_KEY = 'vantage-session';
const USER_KEY = 'vantage-user';

// ─── Session Accessors (sync, for API callers) ────────────────

export function getSession(): VantageSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: VantageSession = JSON.parse(raw);
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
    // Storage full or disabled — non-critical
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

// ─── User Profile Cache (sessionStorage — session-scoped) ────

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
    // Ignore
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

// ─── Auth Initialization (Hard Block) ─────────────────────────
// Users MUST exist in the users table or they cannot proceed.
// Called by AuthProvider on every auth state change.
// The server endpoint checks email confirmation before creating DB rows.

interface VerifyUserResult {
  success: boolean;
  action: 'created' | 'verified';
  user: {
    id: string;
    email: string;
    investorStyleOnboarded: boolean;
  };
}

export async function initializeAuth(): Promise<VerifyUserResult> {
  const session = getSession();
  if (!session?.token) {
    throw new Error('No active session');
  }

  const res = await fetch('/api/auth/verify-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error || body?.details || `Verification failed (${res.status})`;
    console.error('[initializeAuth] ❌ Verify-user failed:', res.status, message);
    throw new Error(message);
  }

  const data: VerifyUserResult = await res.json();
  console.log('[initializeAuth] ✅ User', data.action, '| onboarded:', data.user.investorStyleOnboarded);
  return data;
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
 * Validates a session token from an Authorization header (Bearer) OR
 * the HTTP-only session cookie. Both paths are supported so browser-side
 * fetch() calls work without JavaScript-visible tokens.
 */
export async function requireAuth(
  request: Request
): Promise<{ userId: string; token: string }> {
  const authHeader = request.headers.get('Authorization');

  // ── Path A: Bearer token (Supabase JWT) ──
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
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

  // ── Path B: HTTP-only session cookie (custom auth) ──
  const sessionToken = request.headers.get('cookie')
    ?.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('session='))
    ?.slice('session='.length);

  if (!sessionToken) {
    throw new AuthError('Missing or invalid Authorization header', 401);
  }

  try {
    // Hash the session token for DB lookup (Web Crypto API)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(sessionToken));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sessionHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const supabase = createServerClient();

    const { data: session, error: sessionError } = await (supabase as any)
      .from('user_sessions')
      .select('user_id, expires_at')
      .eq('session_token_hash', sessionHash)
      .single();

    if (sessionError || !session) {
      throw new AuthError('Invalid session', 401);
    }

    if (new Date(session.expires_at) < new Date()) {
      throw new AuthError('Session expired', 401);
    }

    return { userId: session.user_id, token: sessionToken };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Authentication failed', 401);
  }
}
