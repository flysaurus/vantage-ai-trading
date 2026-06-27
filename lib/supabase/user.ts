// ─── User Profile Operations ─────────────────────────────────
// Uses REST API endpoints for DB operations.
// API routes use service_role key (bypasses RLS) and enforce
// user-scoping manually.

import type { InvestorStyle, User } from '@/types';

const API_BASE = '/api/db/users';

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  return fetch(path, { ...init, headers, credentials: 'include' as RequestCredentials });
}

export async function getUserProfile(userId: string): Promise<User | null> {
  try {
    const res = await apiFetch(`${API_BASE}/get?id=${encodeURIComponent(userId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      let detail = '';
      try { const body = await res.json(); detail = body?.detail || body?.error || ''; } catch {}
      console.warn('[users] getUserProfile failed:', res.status, detail);
      return null;
    }
    const data = await res.json();
    return {
      id: data.id,
      email: data.email,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl || undefined,
      investorStyle: data.investorStyle || 'buffett',
      investorStyleSetAt: data.investorStyleSetAt || undefined,
      investorStyleOnboarded: data.investorStyleOnboarded ?? false,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt || undefined,
    };
  } catch (err) {
    console.warn('[users] getUserProfile error:', err);
    return null;
  }
}

export async function updateInvestorStyle(userId: string, style: InvestorStyle): Promise<void> {
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({ userId, investorStyle: style }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[users] updateInvestorStyle failed:', res.status, err.error);
    }
  } catch (err) {
    console.warn('[users] updateInvestorStyle error:', err);
  }
}

export async function completeOnboarding(userId: string): Promise<void> {
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({ userId, investorStyleOnboarded: true, investorStyleSetAt: new Date().toISOString() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[users] completeOnboarding failed:', res.status, err.error);
    }
  } catch (err) {
    console.warn('[users] completeOnboarding error:', err);
  }
}

export async function createUser(params: {
  email: string;
  displayName?: string;
  avatarUrl?: string;
  token?: string;
}): Promise<{ id: string } | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // params.token optional (no longer needed for cookie auth)
    const res = await fetch(`${API_BASE}/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: params.email, displayName: params.displayName, avatarUrl: params.avatarUrl }),
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

export async function updateUser(userId: string, fields: {
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  investorStyle?: InvestorStyle;
  investorStyleOnboarded?: boolean;
}): Promise<boolean> {
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
