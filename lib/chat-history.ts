'use client';

/**
 * Chat history — device-keyed localStorage sessions.
 *
 * Keyed to a stable device ID so sessions survive auth changes
 * (logout / re-login / incognito → same device sees same history).
 *
 * Retention: max 20 sessions, 7-day rolling window.
 * Sessions include the full message array for resumption.
 */

// ── Device ID ─────────────────────────────────────────────────
// Stable across page loads, survives re-auth, unique per browser profile.

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let key = localStorage.getItem('vantage_device_id');
  if (!key) {
    key = 'device_' + Math.random().toString(36).slice(2);
    localStorage.setItem('vantage_device_id', key);
  }
  return key;
}

const DEVICE_ID = typeof window !== 'undefined' ? getDeviceId() : 'ssr';
function getHistoryKey(accountId: string): string {
  return `vantage_chat_history_${DEVICE_ID}_${accountId}`;
}
const MAX_SESSIONS = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Types ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
  timestamp?: number;
}

export interface ChatSessionRecord {
  id: string;
  date: string;              // formatted locale date e.g. "Wednesday, Jun 11"
  preview: string;           // first 80 chars of first AI response
  messageCount: number;
  updatedAt: number;         // epoch ms of last update
  messages: ChatMessage[];   // full message array for resumption
}

// ── Core helpers ──────────────────────────────────────────────

/** Load sessions, trimming expired */
export function loadSessions(accountId: string = 'demo'): ChatSessionRecord[] {
  try {
    const raw = localStorage.getItem(getHistoryKey(accountId));
    if (!raw) return [];
    const sessions: ChatSessionRecord[] = JSON.parse(raw);
    const cutoff = Date.now() - MAX_AGE_MS;
    return sessions.filter(s => s.updatedAt > cutoff);
  } catch {
    return [];
  }
}

/** Save sessions to device-keyed localStorage */
export function saveSessions(sessions: ChatSessionRecord[], accountId: string = 'demo'): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const trimmed = sessions.filter(s => s.updatedAt > cutoff).slice(0, MAX_SESSIONS);
    localStorage.setItem(getHistoryKey(accountId), JSON.stringify(trimmed));
  } catch {
    try { localStorage.setItem(getHistoryKey(accountId), JSON.stringify(sessions.slice(-5))); } catch {}
  }
}

/** Generate a session ID */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Session persistence ───────────────────────────────────────

/**
 * Save the current chat as a session. Creates new or updates existing.
 * Call this after EVERY AI response to keep history live.
 */
export function saveCurrentSession(
  currentSessionId: string,
  messages: ChatMessage[],
  accountId: string = 'demo',
): void {
  if (messages.length === 0) return;

  const sessions = loadSessions(accountId);
  const existing = sessions.findIndex(s => s.id === currentSessionId);

  // Build preview from first AI response
  const firstAi = messages.find(m => m.role === 'ai');
  const preview = firstAi
    ? (firstAi.content?.slice(0, 80) || '') + (firstAi.content?.length > 80 ? '...' : '')
    : 'New conversation';

  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const sessionData: ChatSessionRecord = {
    id: currentSessionId,
    date: `${date}, ${time}`,
    preview,
    messageCount: messages.length,
    updatedAt: Date.now(),
    messages: [...messages],
  };

  if (existing >= 0) {
    sessions[existing] = sessionData;
  } else {
    sessions.unshift(sessionData);
  }

  saveSessions(sessions, accountId);
}

/**
 * Load a specific session's messages by ID.
 * Returns null if not found or expired.
 */
export function loadSessionMessages(sessionId: string, accountId: string = 'demo'): ChatMessage[] | null {
  const sessions = loadSessions(accountId);
  const session = sessions.find(s => s.id === sessionId);
  return session ? session.messages : null;
}

/**
 * Get recent sessions (last N) for the history modal.
 * Returns sessions sorted by most recent first.
 */
export function getRecentSessions(limit: number = 3, accountId: string = 'demo'): ChatSessionRecord[] {
  return loadSessions(accountId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/**
 * Delete a specific session by ID.
 */
export function deleteSession(sessionId: string, accountId: string = 'demo'): void {
  const sessions = loadSessions(accountId).filter(s => s.id !== sessionId);
  saveSessions(sessions, accountId);
}
