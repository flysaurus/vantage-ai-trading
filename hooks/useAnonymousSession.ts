// ─── useAnonymousSession ────────────────────────────────────
// Client hook for anonymous session management.
//
// Provides: anonymousId, firstOpen, daysRemaining, showWarning,
// isAuthenticated, streak data.
//
// Works for both anonymous AND authenticated users:
// - Anonymous: reads timers/settings from localStorage
// - Authenticated: reads from user_profiles DB (server source)
//
// On mount: syncs the daily streak via a server action.
// Streak increment only happens once per day (UTC day boundary).

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getOrCreateAnonymousId,
  getFirstOpen,
  getDaysRemaining,
  getDemoExpiresAt,
  isAnonymousSession,
} from '@/lib/session/anonymous';
import type { StreakData } from '@/lib/session/sync';
import { onDailyOpen } from '@/lib/gamification/events';

// ─── Types ────────────────────────────────────────────────────

export interface AnonymousSessionState {
  anonymousId: string;
  firstOpen: Date;
  daysRemaining: number;
  demoExpiresAt: Date;
  showWarning: boolean;
  isAuthenticated: boolean;
  streak: StreakData | null;
  streakLoading: boolean;
  /** Manually refresh the anonymous session state */
  refresh: () => void;
}

const WARNING_THRESHOLD = 3; // Show warning when ≤ 3 days remain

// ─── Helpers ─────────────────────────────────────────────────

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Hook ────────────────────────────────────────────────────

export function useAnonymousSession(): AnonymousSessionState {
  const [anonymousId, setAnonymousId] = useState<string>('');
  const [firstOpen, setFirstOpen] = useState<Date>(new Date());
  const [daysRemaining, setDaysRemaining] = useState<number>(30);
  const [demoExpiresAt, setDemoExpiresAt] = useState<Date>(new Date());
  const [showWarning, setShowWarning] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [streakLoading, setStreakLoading] = useState<boolean>(true);

  const initialized = useRef(false);
  const todayStreakDone = useRef<string | null>(null);

  const refresh = useCallback(() => {
    const id = getOrCreateAnonymousId();
    const first = getFirstOpen();
    const remaining = getDaysRemaining();
    const expires = getDemoExpiresAt();
    const isAnon = isAnonymousSession();

    setAnonymousId(id);
    setFirstOpen(first);
    setDaysRemaining(remaining);
    setDemoExpiresAt(expires);
    setShowWarning(remaining <= WARNING_THRESHOLD);
    setIsAuthenticated(!isAnon);
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // ── Initial state ──────────────────────────────────────
    refresh();

    // ── Sync streak once per day ───────────────────────────
    const today = getTodayKey();
    const lastStreakSync = sessionStorage.getItem('vantage_streak_synced');

    if (lastStreakSync !== today) {
      setStreakLoading(true);

      const sync = async () => {
        try {
          const id = getOrCreateAnonymousId();
          const res = await fetch('/api/session/streak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anonymousId: id }),
          });

          if (res.ok) {
            const data = await res.json();
            setStreak(data.streak);
            sessionStorage.setItem('vantage_streak_synced', today);
            todayStreakDone.current = today;

            // Fire gamification: daily open + streak milestones
            onDailyOpen(id).catch(() => {});
          }
        } catch (err) {
          console.error('[useAnonymousSession] Streak sync failed:', err);
          // Still functional without streak data
          setStreak({
            anonymous_id: getOrCreateAnonymousId(),
            current_streak: 0,
            longest_streak: 0,
            last_open_date: today,
            total_opens: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } finally {
          setStreakLoading(false);
        }
      };

      sync();
    } else {
      setStreakLoading(false);
    }
  }, [refresh]);

  // Re-evaluate daysRemaining/showWarning on each render
  // (in case the date changed while the tab was open)
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getDaysRemaining();
      setDaysRemaining(remaining);
      setShowWarning(remaining <= WARNING_THRESHOLD);
    }, 60_000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  return {
    anonymousId,
    firstOpen,
    daysRemaining,
    demoExpiresAt,
    showWarning,
    isAuthenticated,
    streak,
    streakLoading,
    refresh,
  };
}
