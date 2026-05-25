// ─── Metrics Operations ──────────────────────────────────────
import { getSession } from '@/lib/auth';
const API_BASE = '/api/db/metrics';

export interface MetricSnapshot {
  id: string; totalValue: number; totalGain: number;
  totalReturn: number; portfolioYield: number;
  avgPe: number | null; concentrationRisk: number;
  recordedAt: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (session?.token) headers['Authorization'] = `Bearer ${session.token}`;
  return fetch(path, { ...init, headers });
}

/** Record a portfolio metric snapshot */
export async function recordMetrics(params: {
  userId: string; totalValue: number; totalGain: number; totalReturn: number;
  portfolioYield?: number; avgPe?: number; concentrationRisk?: number;
}): Promise<{ id: string; totalValue: number; totalGain: number; totalReturn: number; recordedAt: string } | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[metrics] create failed:', res.status); return null; }
  return res.json();
}

/** Fetch metrics for last N days (default 30) */
export async function getMetrics(userId: string, days = 30): Promise<MetricSnapshot[]> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}&days=${days}`);
  if (!res.ok) return [];
  return (await res.json()).metrics || [];
}

/** Fetch the most recent metric snapshot */
export async function getLatestMetrics(userId: string): Promise<MetricSnapshot | null> {
  const res = await apiFetch(`${API_BASE}/get-latest?userId=${encodeURIComponent(userId)}`);
  if (res.status === 404) return null;
  if (!res.ok) { console.warn('[metrics] get-latest failed:', res.status); return null; }
  return res.json();
}

/** Delete metrics older than N days (returns deleted count) */
export async function deleteOldMetrics(userId: string, keepDays = 365): Promise<number> {
  const res = await apiFetch(`${API_BASE}/delete-old`, { method: 'POST', body: JSON.stringify({ userId, keepDays }) });
  if (!res.ok) return 0;
  return (await res.json()).deletedCount || 0;
}
