'use client';

/**
 * Chat history — localStorage-backed sessions with 7-day rolling retention.
 *
 * Session = >30 min gap between messages creates a new session.
 * Sessions are resumable (not read-only).
 */

const STORAGE_KEY = 'vantage-chat-sessions';
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ChatSession {
  id: string;
  timestamp: number; // ms, epoch of first message
  lastActive: number; // ms, epoch of last message
  messages: { role: 'user' | 'ai'; content: string }[];
}

/** Load all sessions from localStorage, prune expired */
export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const sessions: ChatSession[] = JSON.parse(raw);
    const cutoff = Date.now() - MAX_AGE_MS;
    return sessions.filter((s) => s.lastActive > cutoff);
  } catch {
    return [];
  }
}

/** Save sessions to localStorage */
export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // storage full — prune oldest
    const pruned = sessions.slice(-50);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    } catch {
      // give up
    }
  }
}

/** Persist current chat as the latest session. Creates new if gap > 30m. */
export function persistChat(
  messages: { role: 'user' | 'ai'; content: string }[],
  currentSessionId: string | null,
): string {
  if (messages.length === 0) return currentSessionId || generateSessionId();

  const sessions = loadSessions();
  const now = Date.now();

  // Find or create session
  const lastSession = sessions[sessions.length - 1];
  const shouldCreateNew =
    !lastSession || !currentSessionId || now - lastSession.lastActive > SESSION_GAP_MS;

  if (shouldCreateNew) {
    const newSession: ChatSession = {
      id: generateSessionId(),
      timestamp: now,
      lastActive: now,
      messages,
    };
    sessions.push(newSession);
    saveSessions(sessions);
    return newSession.id;
  }

  // Update existing session
  const idx = sessions.findIndex((s) => s.id === currentSessionId);
  if (idx >= 0) {
    sessions[idx] = { ...sessions[idx], messages, lastActive: now };
    saveSessions(sessions);
    return currentSessionId!;
  }

  // Fallback: session ID not found, create new
  const fallback: ChatSession = {
    id: generateSessionId(),
    timestamp: now,
    lastActive: now,
    messages,
  };
  sessions.push(fallback);
  saveSessions(sessions);
  return fallback.id;
}

/** Load a specific session's messages by ID */
export function loadSessionMessages(
  sessionId: string,
): { role: 'user' | 'ai'; content: string }[] | null {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  return session ? session.messages : null;
}

/** Group sessions by day for the bottom sheet */
export function groupSessionsByDay(sessions: ChatSession[]): {
  label: string;
  sessions: ChatSession[];
}[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: { label: string; sessions: ChatSession[] }[] = [];
  const todaySessions: ChatSession[] = [];
  const yesterdaySessions: ChatSession[] = [];
  const olderMap: Map<string, ChatSession[]> = new Map();

  for (const s of sessions) {
    const d = new Date(s.timestamp);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (day.getTime() === today.getTime()) {
      todaySessions.push(s);
    } else if (day.getTime() === yesterday.getTime()) {
      yesterdaySessions.push(s);
    } else {
      const key = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      if (!olderMap.has(key)) olderMap.set(key, []);
      olderMap.get(key)!.push(s);
    }
  }

  if (todaySessions.length) {
    groups.push({ label: 'Today', sessions: todaySessions.reverse() });
  }
  if (yesterdaySessions.length) {
    groups.push({ label: 'Yesterday', sessions: yesterdaySessions.reverse() });
  }
  for (const [label, sess] of olderMap) {
    groups.push({ label, sessions: sess.reverse() });
  }

  return groups;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
