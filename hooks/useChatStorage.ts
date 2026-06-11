'use client';

/**
 * Chat storage hook — routes to Supabase when authenticated,
 * falls back to localStorage in demo mode.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { loadSessions, saveSessions } from '@/lib/chat-history';
import type { ChatSession } from '@/lib/chat-history';
import {
  fetchTodayMessages,
  fetchLastSession,
  saveChatMessage,
  clearTodayMessages,
  getRemainingMessages,
} from '@/lib/chat-service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PreviousSession {
  messages: ChatMessage[];
  date: string; // localized date label
}

export function useChatStorage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  // ── load messages on mount ──
  useEffect(() => {
    if (loading) return;

    const loadMessages = async () => {
      if (userIdRef.current) {
        // Supabase path
        const todayMsgs = await fetchTodayMessages(userIdRef.current);

        if (todayMsgs.length > 0) {
          // Seamless continuation — restore today's messages
          setMessages(
            todayMsgs.map((m) => ({
              role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
              content: m.content,
            }))
          );
        } else {
          // No messages today — check for prior session
          const lastSessionMsgs = await fetchLastSession(userIdRef.current);
          if (lastSessionMsgs.length > 0) {
            const sessionDate = new Date(lastSessionMsgs[0].created_at);
            const label = sessionDate.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            });
            setPreviousSession({
              messages: lastSessionMsgs.map((m) => ({
                role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
                content: m.content,
              })),
              date: label,
            });
          }
        }

        // Load message count
        const remaining = await getRemainingMessages(userIdRef.current);
        setRemainingMessages(remaining);
      } else {
        // localStorage path (demo mode)
        const sessions = loadSessions();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todaySession = sessions.find(
          (s) => new Date(s.timestamp).getTime() >= today.getTime()
        );

        if (todaySession) {
          setMessages(todaySession.messages as ChatMessage[]);
        } else {
          // Find most recent session before today
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
              messages: prev.messages as ChatMessage[],
              date,
            });
          }
        }
      }
    };

    loadMessages();
  }, [loading]);

  // ── persist messages ──
  const persist = useCallback(
    async (msgs: ChatMessage[]) => {
      if (!userIdRef.current) {
        // localStorage fallback
        const sessions = loadSessions();
        const now = Date.now();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existingIdx = sessions.findIndex(
          (s) => new Date(s.timestamp).getTime() >= today.getTime()
        );

        const session: ChatSession = {
          id: existingIdx >= 0 ? sessions[existingIdx].id : `sess_${now}`,
          timestamp: existingIdx >= 0 ? sessions[existingIdx].timestamp : now,
          lastActive: now,
          messages: msgs.map((m) => ({
            role: m.role === 'assistant' ? 'ai' as const : 'user' as const,
            content: m.content,
          })),
        };

        if (existingIdx >= 0) {
          sessions[existingIdx] = session;
        } else {
          sessions.push(session);
        }

        saveSessions(sessions);
        return;
      }

      // Supabase path — save individual messages
      // (we persist per-message in a separate effect)
    },
    []
  );

  // ── send message (persists to Supabase + updates count) ──
  const sendAndPersist = useCallback(
    async (message: string, mode: 'chat' | 'alerts' = 'chat') => {
      const userMsg: ChatMessage = { role: 'user', content: message };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);

      if (userIdRef.current) {
        saveChatMessage(userIdRef.current, 'user', message).catch(console.error);
        // Refresh remaining count
        const remaining = await getRemainingMessages(userIdRef.current);
        setRemainingMessages(remaining);
      } else {
        persist(newMessages);
      }

      return { messages: newMessages, mode };
    },
    [messages, persist]
  );

  // ── on AI response, persist it ──
  const persistAiResponse = useCallback(
    (content: string) => {
      if (userIdRef.current) {
        saveChatMessage(userIdRef.current, 'assistant', content).catch(console.error);
      }
    },
    []
  );

  // ── clear messages ──
  const clearMessages = useCallback(async () => {
    setMessages([]);
    setPreviousSession(null);

    if (userIdRef.current) {
      await clearTodayMessages(userIdRef.current);
    } else {
      const sessions = loadSessions();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const filtered = sessions.filter(
        (s) => new Date(s.timestamp).getTime() < today.getTime()
      );
      saveSessions(filtered);
    }
  }, []);

  // ── load previous session ──
  const loadPreviousSession = useCallback(() => {
    if (previousSession) {
      setMessages(previousSession.messages);
      setPreviousSession(null);
    }
  }, [previousSession]);

  // ── dismiss previous session banner ──
  const dismissPreviousSession = useCallback(() => {
    setPreviousSession(null);
  }, []);

  return {
    messages,
    setMessages,
    previousSession,
    remainingMessages,
    loading,
    sendAndPersist,
    persistAiResponse,
    clearMessages,
    loadPreviousSession,
    dismissPreviousSession,
    persist,
  };
}
