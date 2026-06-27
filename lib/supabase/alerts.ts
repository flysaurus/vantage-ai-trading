// ─── Alert Operations ────────────────────────────────────────
// Uses REST API endpoints for DB operations.


const API_BASE = '/api/db/alerts';

export type AlertType = 'price_above' | 'price_below' | 'percent_change';
export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'telegram';

export interface Alert {
  id: string;
  userId: string;
  symbol: string;
  alertType: AlertType;
  targetValue: number;
  isActive: boolean;
  notificationChannels: NotificationChannel[];
  triggeredAt: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  return fetch(path, { ...init, headers, credentials: 'include' as RequestCredentials, cache: 'no-store' });
}

/**
 * Creates a price alert.
 */
export async function createAlert(params: {
  userId: string;
  symbol: string;
  alertType: AlertType;
  targetValue: number;
  notificationChannels?: NotificationChannel[];
}): Promise<(Alert & { error?: string }) | null> {
  try {
    const res = await apiFetch(`${API_BASE}/create`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error || err?.detail || `HTTP ${res.status}`;
      console.warn('[alerts] create failed:', res.status, msg);
      return { error: msg } as any;
    }
    return await res.json();
  } catch (err: any) {
    console.warn('[alerts] create error:', err?.message || err);
    return { error: err?.message || 'Network error' } as any;
  }
}

/**
 * Fetches alerts for a user. Pass isActive=true/false to filter.
 */
export async function getAlerts(
  userId: string,
  isActive?: boolean,
): Promise<Alert[]> {
  try {
    let url = `${API_BASE}/get-all?userId=${encodeURIComponent(userId)}`;
    if (isActive !== undefined) {
      url += `&isActive=${isActive}`;
    }
    const res = await apiFetch(url);
    if (!res.ok) {
      console.warn('[alerts] get-all failed:', res.status);
      return [];
    }
    const data = await res.json();
    return data.alerts || [];
  } catch (err) {
    console.warn('[alerts] get-all error:', err);
    return [];
  }
}

/**
 * Updates an alert — toggle active or change target value.
 */
export async function updateAlert(
  alertId: string,
  params: { isActive?: boolean; targetValue?: number },
): Promise<{ id: string; alertType: string; targetValue: number; isActive: boolean; updatedAt: string } | null> {
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({ alertId, ...params }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[alerts] update failed:', res.status, err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[alerts] update error:', err);
    return null;
  }
}

/**
 * Deletes an alert by ID.
 */
export async function deleteAlert(alertId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/delete`, {
      method: 'POST',
      body: JSON.stringify({ alertId }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[alerts] delete error:', err);
    return false;
  }
}
