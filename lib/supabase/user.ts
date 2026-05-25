// ─── User Profile Operations ─────────────────────────────────
// Uses REST API endpoints for DB operations.
// API routes use service_role key (bypasses RLS) and enforce
// user-scoping manually. This avoids RLS failures when the
// browser client has no persisted session.

import { getSession } from '@/lib/auth';
import type { InvestorStyle, User } from '@/types';

const API_BASE = '/api/db/users';

/** Shared helper: fetch with auth token */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  return fetch(path, { ...init, headers });
}

/**
 * Fetches the user profile from the API.
 */
export async function getUserProfile(userId: string): Promise<User | null> {
  try {
    const res = await apiFetch(`${API_BASE}/get?id=${encodeURIComponent(userId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      console.warn('[users] getUserProfile failed:', res.status);
      return null;
    }
    const data = await res.json();
    return {
      id: data.id,
      email: data.email,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl,
      investorStyle: data.investorStyle || 'buffett',
      investorStyleSetAt: data.investorStyleSetAt,
      investorStyleOnboarded: data.investorStyleOnboarded ?? false,
      createdAt: data.createdAt,
    };
  } catch (err) {
    console.warn('[users] getUserProfile error:', err);
    return null;
  }
}

/**
 * Updates the user's investor style via the API.
 */
export async function updateInvestorStyle(
  userId: string,
  style: InvestorStyle,
): Promise<void> {
  console.log('👉 [DEBUG updateInvestorStyle] sending POST to /api/db/users/update');
  console.log('👉 [DEBUG updateInvestorStyle] payload:', { userId, investorStyle: style });
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        investorStyle: style,
      }),
    });
    console.log('👉 [DEBUG updateInvestorStyle] response status:', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.log('❌ [DEBUG updateInvestorStyle] failed:', res.status, err);
      console.warn('[users] updateInvestorStyle failed:', res.status, err.error);
    } else {
      console.log('✅ [DEBUG updateInvestorStyle] success');
    }
  } catch (err) {
    console.log('❌ [DEBUG updateInvestorStyle] network error:', err);
    console.warn('[users] updateInvestorStyle error:', err);
  }
}

/**
 * Marks the user as having completed investor style onboarding via the API.
 */
export async function completeOnboarding(userId: string): Promise<void> {
  console.log('👉 [DEBUG completeOnboarding] sending POST to /api/db/users/update');
  console.log('👉 [DEBUG completeOnboarding] payload:', { userId, investorStyleOnboarded: true });
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        investorStyleOnboarded: true,
      }),
    });
    console.log('👉 [DEBUG completeOnboarding] response status:', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.log('❌ [DEBUG completeOnboarding] failed:', res.status, err);
      console.warn('[users] completeOnboarding failed:', res.status, err.error);
    } else {
      console.log('✅ [DEBUG completeOnboarding] success');
    }
  } catch (err) {
    console.log('❌ [DEBUG completeOnboarding] network error:', err);
    console.warn('[users] completeOnboarding error:', err);
  }
}

/**
 * Creates a new user record via the API.
 */
export async function createUser(params: {
  email: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<{ id: string } | null> {
  try {
    const res = await apiFetch(`${API_BASE}/create`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[users] createUser failed:', res.status, err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[users] createUser error:', err);
    return null;
  }
}

/**
 * Updates any user fields via the API.
 */
export async function updateUser(
  userId: string,
  fields: {
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    investorStyle?: InvestorStyle;
    investorStyleOnboarded?: boolean;
  },
): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({ userId, ...fields }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[users] updateUser error:', err);
    return false;
  }
}

/**
 * Soft-deletes a user via the API.
 */
export async function deleteUser(userId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/delete`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[users] deleteUser error:', err);
    return false;
  }
}
