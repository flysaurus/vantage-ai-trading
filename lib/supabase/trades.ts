// ─── Trade History Operations ────────────────────────────────
import { getSession } from '@/lib/auth';
const API_BASE = '/api/db/trade-history';

export interface Trade {
  id: string; symbol: string; action: 'buy' | 'sell';
  quantity: number; price: number; totalValue: number;
  commission: number | null; notes: string | null;
  executedAt: string; createdAt: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (session?.token) headers['Authorization'] = `Bearer ${session.token}`;
  return fetch(path, { ...init, headers });
}

export async function createTrade(params: { userId: string; symbol: string; action: 'buy' | 'sell'; quantity: number; price: number; commission?: number; notes?: string }): Promise<Trade | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[trades] create failed:', res.status); return null; }
  return res.json();
}

export async function getTrades(userId: string, limit = 100, offset = 0): Promise<{ trades: Trade[]; total: number }> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`);
  if (!res.ok) return { trades: [], total: 0 };
  return res.json();
}

export async function getTrade(tradeId: string): Promise<Trade | null> {
  const res = await apiFetch(`${API_BASE}/get-single?id=${encodeURIComponent(tradeId)}`);
  if (res.status === 404) return null;
  if (!res.ok) { console.warn('[trades] get-single failed:', res.status); return null; }
  return res.json();
}

export async function deleteTrade(tradeId: string): Promise<boolean> {
  const res = await apiFetch(`${API_BASE}/delete`, { method: 'POST', body: JSON.stringify({ tradeId }) });
  return res.ok;
}
