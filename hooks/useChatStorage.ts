'use client';

/**
 * Chat storage hook — routes to Supabase when authenticated,
 * falls back to localStorage in demo mode.
 *
 * Does NOT manage messages state — that's owned by the parent (AppShell).
 * Provides: previous session detection, message counts, clear/load helpers.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { loadSessions } from '@/lib/chat-history';
import {
  fetchTodayMessages,
  fetchLastSession,
  clearTodayMessages,
  getRemainingMessages,
} from '@/lib/chat-service';

export interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

export interface PreviousSession {
  messages: ChatMessage[];
  date: string; // localized date label
}

export function useChatStorage() {
  const [previousSession, setPreviousSession] = useState<PreviousSession | null>(null);
  const [remainingMessages, setRemainingMessages] = useState(25);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const userIdRef = useRef<string | null>(null);

  // ── detect auth state on mount ──
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          userIdRef.current = data.session.user.id;
          setIsAuthenticated(true);
        }
      } catch {
        // not authenticated — use localStorage
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  // ── load previous session detection + message count on mount ──
  useEffect(() => {
    if (loading) return;

    const detectPreviousSession = async () => {
      if (userIdRef.current) {
        // Supabase path
        const lastMsgs = await fetchLastSession(userIdRef.current);
        if (lastMsgs.length > 0) {
          const sessionDate = new Date(lastMsgs[0].created_at);
          const label = sessionDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          });
          setPreviousSession({
            messages: lastMsgs.map((m) => ({
              role: m.role as 'user' | 'ai',
              content: m.content,
            })),
            date: label,
          });
        }

        const remaining = await getRemainingMessages(userIdRef.current);
        setRemainingMessages(remaining);
      } else {
        // localStorage path (demo mode)
        const sessions = loadSessions();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const prevSessions = sessions
          .filter((s) => new Date(s.timestamp).getTime() < today.getTime())
          .sort((a, b) => b.lastActive - a.lastActive);

        if (prevSessions.length > 0) {
          const prev = prevSessions[0];
          const date = new Date(prev.timestamp).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          });
          setPreviousSession({
            messages: prev.messages.map((m) => ({
              role: m.role as 'user' | 'ai',
              content: m.content,
            })),
            date,
          });
        }
      }
    };

    detectPreviousSession();
  }, [loading]);

  // ── load previous session (returns messages for caller to set) ──
  const loadPreviousSession = useCallback((): ChatMessage[] | null => {
    if (!previousSession) return null;
    const msgs = previousSession.messages;
    setPreviousSession(null);
    return msgs;
  }, [previousSession]);

  // ── dismiss previous session banner ──
  const dismissPreviousSession = useCallback(() => {
    setPreviousSession(null);
  }, []);

  // ── clear today's messages ──
  const clearMessages = useCallback(async () => {
    if (userIdRef.current) {
      await clearTodayMessages(userIdRef.current);
      const remaining = await getRemainingMessages(userIdRef.current);
      setRemainingMessages(remaining);
    }
  }, []);

  return {
    previousSession,
    remainingMessages,
    loading,
    clearMessages,
    loadPreviousSession,
    dismissPreviousSession,
  };
}
