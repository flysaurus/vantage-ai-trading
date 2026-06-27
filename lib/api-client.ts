// ─── Shared API Client ───────────────────────────────────────
// Every authenticated API call must go through these helpers.
// Auth handled by Supabase HTTP-only cookies — no manual tokens.
// All requests include `credentials: 'include'` to send cookies.
//
// Usage:
//   import { apiGet, apiPost } from '@/lib/api-client'
//   const res = await apiGet('/api/broker/status')
//   const res = await apiPost('/api/strategies/execute', { ... })

async function handleResponse(res: Response): Promise<Response> {
  return res;
}

export async function apiGet(
  endpoint: string,
  init?: Omit<RequestInit, 'method' | 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
  return fetch(endpoint, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
  return fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
  return fetch(endpoint, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
  return fetch(endpoint, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
 * Handle 401 errors by redirecting to /login.
 * Supabase Auth manages cookies automatically — no manual token clearing.
 */
export function handleAuthError(res: Response): void {
  if (!isAuthError(res)) return;
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

/** Check if response is OK, return parsed JSON */
export async function parseJSON<T = unknown>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}
