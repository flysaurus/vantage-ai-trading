// ─── Strategy Operations ─────────────────────────────────────
import { getAccessToken } from '@/lib/auth';
const API_BASE = '/api/db/strategies';

export interface Strategy {
  id: string; userId: string; name: string; description: string | null;
  investorStyle: string | null; targetAllocation: Record<string, number>;
  stocks: string[]; performanceNotes: string | null;
  createdAt: string; updatedAt?: string | null;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(path, { ...init, headers });
}

export async function createStrategy(params: { userId: string; name: string; description?: string; investorStyle?: string; targetAllocation?: Record<string, number>; stocks?: string[] }): Promise<Strategy | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[strategies] create failed:', res.status); return null; }
  return res.json();
}

export async function getStrategies(userId: string): Promise<Strategy[]> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) return [];
  return (await res.json()).strategies || [];
}

export async function getStrategy(strategyId: string): Promise<Strategy | null> {
  const res = await apiFetch(`${API_BASE}/get-single?id=${encodeURIComponent(strategyId)}`);
  if (res.status === 404) return null;
  if (!res.ok) { console.warn('[strategies] get-single failed:', res.status); return null; }
  return res.json();
}

export async function updateStrategy(strategyId: string, params: { name?: string; description?: string; targetAllocation?: Record<string, number>; stocks?: string[]; performanceNotes?: string }): Promise<{ id: string; name: string; stocks: string[]; updatedAt: string } | null> {
  const res = await apiFetch(`${API_BASE}/update`, { method: 'POST', body: JSON.stringify({ strategyId, ...params }) });
  if (!res.ok) { console.warn('[strategies] update failed:', res.status); return null; }
  return res.json();
}

export async function deleteStrategy(strategyId: string): Promise<boolean> {
  const res = await apiFetch(`${API_BASE}/delete`, { method: 'POST', body: JSON.stringify({ strategyId }) });
  return res.ok;
}
