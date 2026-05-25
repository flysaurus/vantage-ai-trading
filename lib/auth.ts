// ─── Auth Utilities ───────────────────────────────────────────
// Session lifecycle managed by Supabase SDK (autoRefreshToken, persistSession).
// This file provides: sync token accessors, user profile cache, and API middleware.
//
// getSession() reads a parallel localStorage copy synced by AuthProvider.
// Supabase SDK handles actual login/refresh/logout via onAuthStateChange.

import { createAuthClient } from './supabase';
import type { VantageSession, User } from '@/types';

const SESSION_KEY = 'vantage-session';
const USER_KEY = 'vantage-user';

// ─── Session Accessors (sync, for API callers) ────────────────

export function getSession(): VantageSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
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
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage full or disabled — non-critical
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_KEY);
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
 * Validates a session token from an Authorization header.
 * For use in API route handlers.
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
      throw new AuthError('Invalid or expired token', 401);
    }
    return { userId: data.user.id, token };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Authentication failed', 401);
  }
}
