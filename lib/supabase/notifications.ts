// ─── Notification Operations ─────────────────────────────────
import { getAccessToken } from '@/lib/auth';
const API_BASE = '/api/db/recent-notifications';

export interface Notification {
  id: string; title: string; message: string | null;
  type: 'alert' | 'suggestion' | 'info'; isRead: boolean; createdAt: string;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(path, { ...init, headers });
}

export async function createNotification(params: { userId: string; title: string; message?: string; type?: 'alert' | 'suggestion' | 'info' }): Promise<{ id: string; title: string; type: string; isRead: boolean; createdAt: string } | null> {
  const res = await apiFetch(`${API_BASE}/create`, { method: 'POST', body: JSON.stringify(params) });
  if (!res.ok) { console.warn('[notifications] create failed:', res.status); return null; }
  return res.json();
}

export async function getNotifications(userId: string, unreadOnly = false): Promise<Notification[]> {
  const res = await apiFetch(`${API_BASE}/get-all?userId=${encodeURIComponent(userId)}${unreadOnly ? '&unreadOnly=true' : ''}`);
  if (!res.ok) return [];
  return (await res.json()).notifications || [];
}

export async function markNotificationsRead(userId: string, notificationIds: string[]): Promise<number> {
  const res = await apiFetch(`${API_BASE}/mark-read`, { method: 'POST', body: JSON.stringify({ userId, notificationIds }) });
  if (!res.ok) return 0;
  return (await res.json()).markedCount || 0;
}
