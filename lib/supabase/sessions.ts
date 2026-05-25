// ─── Session Operations ──────────────────────────────────────
import { getSession } from '@/lib/auth';
const API_BASE = '/api/db/sessions';

export interface Session {
  id: string; token: string; ipAddress: string | null;
  userAgent: string | null; expiresAt: string; createdAt: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (session?.token) headers['Authorization'] = `Bearer ${session.token}`;
  return fetch(path, { ...init, headers });
}

export async function createSession(params: { userId: string; token: string; ipAddress?: string; userAgent?: string; expiresAt: string }): Promise<{ id: string; userId: string; expiresAt: string; createdAt: string } | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[sessions] create failed:', res.status); return null; }
  return res.json();
}

export async function getSessions(userId: string): Promise<Session[]> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) return [];
  return (await res.json()).sessions || [];
}

export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const res = await apiFetch(`${API_BASE}/delete`, { method: 'POST', body: JSON.stringify({ sessionId, userId }) });
  return res.ok;
}
