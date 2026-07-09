'use client';

/**
 * Chat history — Supabase-backed session retrieval.
 *
 * Groups chat_messages by date (day boundary) into sessions.
 * Used for: mount hydration, history modal, cross-device sync.
 *
 * Does NOT replace lib/chat-history.ts (device-keyed localStorage cache)
 * — localStorage is used as offline cache only, Supabase is authority.
 */

import { createClient } from '@/lib/supabase';

export interface DBSession {
  id: string;          // e.g. "2026-07-08"
  label: string;       // e.g. "Today", "Yesterday", "Jul 7"
  date: string;        // ISO date YYYY-MM-DD
  timestamp: number;   // epoch ms (latest message time)
  preview: string;     // first AI response snippet
  messageCount: number;
  messages: DBChatMessage[];
}

export interface DBChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  createdAt: string;
}

const MAX_SESSIONS = 10;

/**
 * Fetch recent chat sessions from Supabase, grouped by date.
 * Returns up to MAX_SESSIONS, newest first.
 */
export async function fetchRecentSessions(
  userId: string,
  limit: number = MAX_SESSIONS,
  retentionDays: number = 7,
): Promise<DBSession[]> {
  const supabase = createClient();

  // 7-day rolling window cutoff
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  cutoff.setHours(0, 0, 0, 0);

  // Fetch recent messages within retention window (up to 500 — enough to find 10+ days)
  const { data, error } = await (supabase as any)
    .from('chat_messages')
    .select('id, user_id, role, content, created_at')
    .eq('user_id', userId)
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !data) {
    console.error('[chat-history-db] fetch failed:', error?.message);
    return [];
  }

  // Helper: format a Date as YYYY-MM-DD in the browser's local timezone
  // (NOT UTC — Supabase stores UTC but the user sees dates in their timezone)
  const localDateStr = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Group messages by date (YYYY-MM-DD) in BROWSER LOCAL timezone
  const dayMap = new Map<string, DBChatMessage[]>();
  for (const msg of data) {
    const date = localDateStr(new Date(msg.created_at));
    if (!dayMap.has(date)) dayMap.set(date, []);
    dayMap.get(date)!.push({
      id: msg.id,
      role: (msg.role === 'assistant' || msg.role === 'ai') ? 'ai' : 'user',
      content: msg.content || '',
      createdAt: msg.created_at,
    });
  }

  // Convert to sessions, newest date first
  const sessions: DBSession[] = [];
  const sortedDates = [...dayMap.keys()].sort((a, b) => b.localeCompare(a));

  for (const date of sortedDates.slice(0, limit)) {
    const msgs = dayMap.get(date)!;
    // Sort messages within day: oldest first
    msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const latestTs = Math.max(...msgs.map(m => new Date(m.createdAt).getTime()));
    const firstAi = msgs.find(m => m.role === 'ai');
    const rawPreview = firstAi?.content || msgs[0]?.content || '';
    // Get first meaningful line (skip markdown headers, blank lines)
    const previewLine = rawPreview
      .split('\n')
      .find(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('|') && l.trim().length > 10)
      || rawPreview.slice(0, 80);

    // Format the session date label in the user's local timezone
    // Always show the actual date (no relative "Today"/"Yesterday" labels)
    const sessionDate = new Date(date + 'T12:00:00');
    const label = sessionDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    sessions.push({
      id: date,
      label,
      date,
      timestamp: latestTs,
      preview: previewLine.slice(0, 120),
      messageCount: msgs.length,
      messages: msgs,
    });
  }

  return sessions;
}

/**
 * Fetch messages for a specific date (session).
 */
export async function fetchSessionMessages(
  userId: string,
  dateStr: string, // YYYY-MM-DD
): Promise<DBChatMessage[]> {
  const supabase = createClient();
  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;

  const { data, error } = await (supabase as any)
    .from('chat_messages')
    .select('id, user_id, role, content, created_at')
    .eq('user_id', userId)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data.map((msg: any) => ({
    id: msg.id,
    role: (msg.role === 'assistant' || msg.role === 'ai') ? 'ai' : 'user',
    content: msg.content || '',
    createdAt: msg.created_at,
  }));
}
