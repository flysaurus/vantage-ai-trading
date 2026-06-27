// ─── Trade History Operations ────────────────────────────────
const API_BASE = '/api/db/trade-history';

export interface Trade {
  id: string; symbol: string; action: 'buy' | 'sell';
  quantity: number; price: number; totalValue: number;
  commission: number | null; notes: string | null;
  executedAt: string; createdAt: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  return fetch(path, { ...init, headers, credentials: 'include' as RequestCredentials });
}

export async function createTrade(params: { userId: string; symbol: string; action: 'buy' | 'sell'; quantity: number; price: number; commission?: number; notes?: string; alpacaOrderId?: string; executedAt?: string }): Promise<(Trade & { _existing?: boolean }) | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[trades] create failed:', res.status, await res.text()); return null; }
  return res.json();
}

/** Syncs filled broker orders to the trade_history table. Deduplicates by alpacaOrderId. */
export async function syncFilledOrders(
  userId: string,
  filledOrders: Array<{
    id: string; symbol: string; side: 'buy' | 'sell';
    filledQty: number; filledPrice: number; createdAt: string;
  }>,
): Promise<number> {
  let synced = 0;
  for (const order of filledOrders) {
    if (!order.filledPrice || !order.filledQty) continue;
    const result = await createTrade({
      userId,
      symbol: order.symbol,
      action: order.side,
      quantity: order.filledQty,
      price: order.filledPrice,
      alpacaOrderId: order.id,
      executedAt: order.createdAt,
    });
    if (result && !result._existing) synced++;
  }
  return synced;
}

export async function getTrades(userId: string, limit = 100, offset = 0): Promise<{ trades: Trade[]; total: number }> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`, { cache: 'no-store' });
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
