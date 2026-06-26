// ─── Scanner Recommendation Operations ───────────────────────
import { getAccessToken } from '@/lib/auth';
const API_BASE = '/api/db/scanner-recommendations';

export interface ScannerRecommendation {
  id: string; symbol: string; recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  reason: string | null; createdAt: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(path, { ...init, headers });
}

export async function createScannerRecommendation(params: { userId: string; symbol: string; recommendation: 'BUY_MORE' | 'HOLD' | 'SELL'; reason?: string }): Promise<ScannerRecommendation | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[scanner] create failed:', res.status); return null; }
  return res.json();
}

export async function getScannerRecommendations(userId: string): Promise<ScannerRecommendation[]> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) return [];
  return (await res.json()).recommendations || [];
}
