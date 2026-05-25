// ─── Chat History Operations ──────────────────────────────────
// Uses REST API endpoints for DB operations.
// API routes use service_role key (bypasses RLS) and enforce
// user-scoping manually.

import { getSession } from '@/lib/auth';

const API_BASE = '/api/db/chat-history';

export interface ChatMessage {
  id: string;
  userId: string;
  messageType: 'user_message' | 'ai_response';
  content: string;
  investorStyle?: string | null;
  relatedStocks?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string | null;
}

/** Shared helper: fetch with auth token */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };
  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  return fetch(path, { ...init, headers });
}

/**
 * Saves a chat message to the database.
 */
export async function saveMessage(params: {
  userId: string;
  messageType: 'user_message' | 'ai_response';
  content: string;
  investorStyle?: string;
  relatedStocks?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  try {
    const res = await apiFetch(`${API_BASE}/create`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[chat] saveMessage failed:', res.status, err.error);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[chat] saveMessage error:', err);
    return null;
  }
}

/**
 * Fetches paginated chat messages for a user (newest first).
 */
export async function getMessages(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{ messages: ChatMessage[]; total: number } | null> {
  try {
    const res = await apiFetch(
      `${API_BASE}/get-all?userId=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`,
    );
    if (!res.ok) {
      console.warn('[chat] getMessages failed:', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[chat] getMessages error:', err);
    return null;
  }
}

/**
 * Fetches a single message by ID.
 */
export async function getMessage(messageId: string): Promise<ChatMessage | null> {
  try {
    const res = await apiFetch(`${API_BASE}/get-single?id=${encodeURIComponent(messageId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      console.warn('[chat] getMessage failed:', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[chat] getMessage error:', err);
    return null;
  }
}

/**
 * Updates a chat message (content or metadata).
 */
export async function updateMessage(
  messageId: string,
  params: { content?: string; metadata?: Record<string, unknown> },
): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/update`, {
      method: 'POST',
      body: JSON.stringify({ messageId, ...params }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[chat] updateMessage error:', err);
    return false;
  }
}

/**
 * Deletes a chat message by ID.
 */
export async function deleteMessage(messageId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${API_BASE}/delete`, {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[chat] deleteMessage error:', err);
    return false;
  }
}

/**
 * Saves multiple messages in bulk (for syncing localStorage to DB).
 */
export async function saveMessages(
  messages: Array<{
    userId: string;
    messageType: 'user_message' | 'ai_response';
    content: string;
    investorStyle?: string;
  }>,
): Promise<number> {
  let saved = 0;
  for (const msg of messages) {
    const result = await saveMessage(msg);
    if (result) saved++;
  }
  return saved;
}
