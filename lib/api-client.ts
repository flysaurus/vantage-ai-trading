// ─── Shared API Client ───────────────────────────────────────
// Every authenticated API call must go through these helpers.
// Automatically attaches the Supabase JWT from localStorage.
//
// Usage:
//   import { apiGet, apiPost } from '@/lib/api-client'
//   const res = await apiGet('/api/broker/status')
//   const res = await apiPost('/api/strategies/execute', { ... })

const TOKEN_KEY = 'vantage-auth-token';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

async function handleResponse(res: Response): Promise<Response> {
  // Don't auto-redirect — let callers decide how to handle 401
  return res;
}

export async function apiGet(
  endpoint: string,
  init?: Omit<RequestInit, 'method' | 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  const token = getToken();

  return fetch(endpoint, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  }).then(handleResponse);
}

export async function apiPost(
  endpoint: string,
  body?: unknown,
  init?: Omit<RequestInit, 'method' | 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  const token = getToken();

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  }).then(handleResponse);
}

export async function apiDelete(
  endpoint: string,
  init?: Omit<RequestInit, 'method' | 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  const token = getToken();

  return fetch(endpoint, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  }).then(handleResponse);
}

export async function apiPut(
  endpoint: string,
  body?: unknown,
  init?: Omit<RequestInit, 'method' | 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  const token = getToken();

  return fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  }).then(handleResponse);
}

/** Check if an API response is a 401 auth error */
export function isAuthError(res: Response): boolean {
  return res.status === 401;
}

/**
 * Handle 401 errors by clearing the token and redirecting to /login.
 * Use this in components that should redirect on auth failure.
 */
export function handleAuthError(res: Response): void {
  if (!isAuthError(res)) return;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

/** Check if response is OK, return parsed JSON */
export async function parseJSON<T = unknown>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}
