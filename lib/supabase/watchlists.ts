// ─── Watchlist Operations ────────────────────────────────────
// Uses REST API endpoints for DB operations.


const API_BASE = '/api/db/watchlists';

export interface WatchlistStock {
  symbol: string;
  addedAt: string;
}

export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  stocks: WatchlistStock[];
  isDefault: boolean;
  createdAt: string;
  updatedAt?: string;
}

/** Shared helper: fetch with auth token */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  return fetch(path, { ...init, headers, credentials: 'include' as RequestCredentials, cache: 'no-store' });
}

/**
 * Creates a new watchlist.
 */
export async function createWatchlist(params: {
  userId: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}): Promise<Watchlist | null> {
  try {
    const res = await apiFetch(`${API_BASE}/create`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[watchlists] create failed:', res.status, err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[watchlists] create error:', err);
    return null;
  }
}

/**
 * Fetches all watchlists for a user.
 */
export async function getWatchlists(userId: string): Promise<Watchlist[]> {
  try {
    const res = await apiFetch(
      `${API_BASE}/get-all?userId=${encodeURIComponent(userId)}`
    );
    if (!res.ok) {
      console.warn('[watchlists] get-all failed:', res.status);
      return [];
    }
    const data = await res.json();
    return data.watchlists || [];
  } catch (err) {
    console.warn('[watchlists] get-all error:', err);
    return [];
  }
}

/**
 * Adds a stock symbol to a watchlist. Returns the updated stocks array.
 */
export async function addStockToWatchlist(
  watchlistId: string,
  symbol: string
): Promise<{ id: string; stocks: WatchlistStock[]; updatedAt: string } | null> {
  try {
    const res = await apiFetch(`${API_BASE}/add-stock`, {
      method: 'POST',
      body: JSON.stringify({ watchlistId, symbol }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[watchlists] add-stock failed:', res.status, err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[watchlists] add-stock error:', err);
    return null;
  }
}

/**
 * Removes a stock symbol from a watchlist. Returns the updated stocks array.
 */
export async function removeStockFromWatchlist(
  watchlistId: string,
  symbol: string
): Promise<{ id: string; stocks: WatchlistStock[]; updatedAt: string } | null> {
  try {
    const res = await apiFetch(`${API_BASE}/remove-stock`, {
      method: 'POST',
      body: JSON.stringify({ watchlistId, symbol }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[watchlists] remove-stock failed:', res.status, err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[watchlists] remove-stock error:', err);
    return null;
  }
}

/**
 * Updates a watchlist name and/or description.
 */
export async function updateWatchlist(
  watchlistId: string,
  params: { name: string; description?: string }
): Promise<{ id: string; name: string; description: string | null; updatedAt: string } | null> {
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({ watchlistId, ...params }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[watchlists] update failed:', res.status, err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[watchlists] update error:', err);
    return null;
  }
}

/**
 * Deletes an entire watchlist.
 */
export async function deleteWatchlist(watchlistId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/delete`, {
      method: 'POST',
      body: JSON.stringify({ watchlistId }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[watchlists] delete error:', err);
    return false;
  }
}
