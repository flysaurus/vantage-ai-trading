'use client';

/**
 * Chat storage hook — loads recent sessions for the history modal
 * and detects previous sessions on mount.
 *
 * Uses device-keyed localStorage (survives auth changes).
 * Does NOT manage messages state — that's owned by the chat store (Zustand).
 */

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { getRecentSessions, loadSessionMessages, type ChatSessionRecord } from '@/lib/chat-history';
import {
  fetchLastSession,
  getRemainingMessages,
} from '@/lib/chat-service';

export interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

export interface PreviousSession {
  messages: ChatMessage[];
  date: string;
  sessionId?: string;
}

export function useChatStorage(accountId: string = 'demo') {
  const [previousSession, setPreviousSession] = useState<PreviousSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<ChatSessionRecord[]>([]);
  const [remainingMessages, setRemainingMessages] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // ── load sessions on mount ──
  useEffect(() => {
    const loadRecent = async () => {
      try {
        // Try Supabase first for authenticated users
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          const remaining = await getRemainingMessages(data.session.user.id);
          setRemainingMessages(remaining);

          // Load last session from Supabase (scoped to the active account)
          const lastMsgs = await fetchLastSession(data.session.user.id, accountId);
          if (lastMsgs.length > 0) {
            const sessionDate = new Date(lastMsgs[0].created_at);
            const label = sessionDate.toLocaleDateString('en-US', {
              weekday: 'long', month: 'short', day: 'numeric',
            });
            setPreviousSession({
              messages: lastMsgs.map((m: any) => ({
                role: (m.role === 'assistant' ? 'ai' : 'user') as 'user' | 'ai',
                content: m.content,
              })),
              date: label,
            });
          }
        }
      } catch {
        // Not authenticated — fall through to device-keyed localStorage
      }

      // Always load device-keyed recent sessions (scoped to active account)
      const deviceSessions = getRecentSessions(3, accountId);
      setRecentSessions(deviceSessions);
      setLoading(false);
    };

    loadRecent();
  }, [accountId]);

  // ── load previous session messages into chat ──
  const loadPreviousSession = useCallback((): ChatMessage[] | null => {
    if (!previousSession) return null;
    const msgs = previousSession.messages;
    setPreviousSession(null);
    return msgs;
  }, [previousSession]);

  // ── resume a specific device-keyed session ──
  const resumeSession = useCallback((sessionId: string): ChatMessage[] | null => {
    const msgs = loadSessionMessages(sessionId, accountId);
    return msgs || null;
  }, [accountId]);

  // ── dismiss previous session banner ──
  const dismissPreviousSession = useCallback(() => {
    setPreviousSession(null);
  }, []);

  // ── refresh recent sessions ──
  const refreshSessions = useCallback(() => {
    setRecentSessions(getRecentSessions(3, accountId));
  }, [accountId]);

  return {
    previousSession,
    recentSessions,
    remainingMessages,
    loading,
    loadPreviousSession,
    resumeSession,
    dismissPreviousSession,
    refreshSessions,
  };
}
