// ─── Trade History Operations ────────────────────────────────
const API_BASE = '/api/db/trade-history';

export interface Trade {
  id: string; symbol: string; action: 'buy' | 'sell';
  quantity: number; price: number; totalValue: number;
  commission: number | null; notes: string | null;
  executedAt: string; createdAt: string;
}

// `${userId}:${brokerOrderId}` for every order the server already holds.
const syncedOrderIds = new Set<string>();

/** Test hook: clears the session dedup set. */
export function __clearSyncedFilledOrderCache(): void {
  syncedOrderIds.clear();
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  return fetch(path, { ...init, headers, credentials: 'include' as RequestCredentials });
}

export async function createTrade(params: { userId: string; symbol: string; action: 'buy' | 'sell'; quantity: number; price: number; commission?: number; notes?: string; alpacaOrderId?: string; executedAt?: string; connectionId?: string | null; snapAccountId?: string | null; isDemo?: boolean }): Promise<(Trade & { _existing?: boolean }) | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[trades] create failed:', res.status, await res.text()); return null; }
  return res.json();
}

/**
 * Syncs filled broker orders to the trade_history table. Deduplicates by order id.
 *
 * One BATCHED request per sync pass (POST /trade-history/sync-batch), not one
 * request per order. Measured live on prod: a fresh page load re-POSTed the
 * whole filled book one order at a time — 35–36 sequential requests, ~20s of
 * churn per load, for rows the server already had. The server now does the work
 * once (one dedupe read, one account resolve, one insert).
 *
 * Dedup is still two-layered:
 *   - client: the session set below, so a re-run after a 30s poll doesn't resend
 *     an order this session already synced (the server would no-op it, but the
 *     payload is smaller if we don't send it);
 *   - server: matches the order against what the table already holds.
 */
export async function syncFilledOrders(
  userId: string,
  filledOrders: Array<{
    id: string; symbol: string; side: 'buy' | 'sell';
    filledQty: number; filledPrice: number; createdAt: string;
  }>,
  connectionId?: string | null,
  snapAccountId?: string | null,
): Promise<number> {
  // Claim every key BEFORE awaiting: two refresh passes can overlap (the hook is
  // mounted by more than one component and a poll can land mid-refresh); when
  // the mark was added after the await, both passes saw "not synced" and sent
  // the same order — measured live: 36 of 64 orders were sent twice per burst.
  // Claiming first makes the check-then-act atomic (single-threaded JS); a failed
  // batch releases every claim so a later attempt can retry.
  const claimed: Array<{ key: string; order: unknown }> = [];
  const orders: Array<{ symbol: string; action: 'buy' | 'sell'; quantity: number; price: number; executedAt: string }> = [];

  for (const order of filledOrders) {
    if (!order.filledPrice || !order.filledQty) continue;
    const key = `${userId}:${order.id}`;
    if (syncedOrderIds.has(key)) continue;
    syncedOrderIds.add(key);
    claimed.push({ key, order });
    orders.push({
      symbol: order.symbol,
      action: order.side,
      quantity: order.filledQty,
      price: order.filledPrice,
      executedAt: order.createdAt,
    });
  }

  if (orders.length === 0) return 0;

  const res = await apiFetch(`${API_BASE}/sync-batch`, {
    method: 'POST',
    body: JSON.stringify({
      userId,
      connectionId: connectionId ?? null,
      // Same active-account context the read path uses — never re-derived.
      // Without it, a shared login (2+ sub-accounts) leaves the rows unattributed.
      snapAccountId: snapAccountId ?? null,
      orders,
    }),
  });

  if (!res.ok) {
    // Release so the next pass retries rather than silently losing the fills.
    for (const c of claimed) syncedOrderIds.delete(c.key);
    console.warn('[trades] batch sync failed:', res.status, await res.text().catch(() => ''));
    return 0;
  }

  const json = await res.json().catch(() => null);
  return typeof json?.inserted === 'number' ? json.inserted : 0;
}

export async function getTrades(userId: string, limit = 100, offset = 0, connectionId?: string | null): Promise<{ trades: Trade[]; total: number }> {
  const params = new URLSearchParams({ userId, limit: String(limit), offset: String(offset) });
  if (connectionId) params.set('connectionId', connectionId);
  const res = await apiFetch(`${API_BASE}/get-all?${params.toString()}`, { cache: 'no-store' });
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
