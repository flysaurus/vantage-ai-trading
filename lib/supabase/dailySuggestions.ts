// ─── Daily Suggestion Operations ─────────────────────────────
import { getAccessToken } from '@/lib/auth';
const API_BASE = '/api/db/daily-suggestions';

export interface DailySuggestion {
  id: string; suggestionText: string; relatedStocks: string[];
  actionSuggested: string | null; isActedUpon: boolean; createdAt: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(path, { ...init, headers });
}

export async function createDailySuggestion(params: { userId: string; suggestionText: string; relatedStocks?: string[]; actionSuggested?: string }): Promise<DailySuggestion | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[dailySuggestions] create failed:', res.status); return null; }
  return res.json();
}

export async function getDailySuggestions(userId: string, days = 7): Promise<DailySuggestion[]> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}&days=${days}`);
  if (!res.ok) return [];
  return (await res.json()).suggestions || [];
}
