// ─── useInactivity — Auto-logout after inactivity ─────────────
// After 8 minutes of inactivity → shows warning modal
// After 10 minutes (2 min countdown) → force signs out
//
// Usage: const { showWarning, countdown, resetActivity, signOutNow } = useInactivity();

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

const INACTIVITY_WARNING_MS = 8 * 60 * 1000; // 8 minutes
const INACTIVITY_LOGOUT_MS = 10 * 60 * 1000; // 10 minutes
const COUNTDOWN_SECONDS = 120; // 2 minutes

interface UseInactivityReturn {
  showWarning: boolean;
  countdown: number; // seconds remaining, 120 → 0
  resetActivity: () => void;
  signOutNow: () => void;
}

export function useInactivity(): UseInactivityReturn {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
  }, []);

  const startTimers = useCallback(() => {
    clearTimers();

    const timeSinceActivity = Date.now() - lastActivityRef.current;
    const remainingToWarning = Math.max(0, INACTIVITY_WARNING_MS - timeSinceActivity);
    const remainingToLogout = Math.max(0, INACTIVITY_LOGOUT_MS - timeSinceActivity);

    // Schedule warning at 8 min
    if (remainingToWarning > 0) {
      warningTimerRef.current = setTimeout(() => {
        setShowWarning(true);
        setCountdown(COUNTDOWN_SECONDS);

        // Start countdown ticker
        countdownIntervalRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }, remainingToWarning);
    }

    // Schedule auto-logout at 10 min
    logoutTimerRef.current = setTimeout(() => {
      performSignOut();
    }, remainingToLogout);
  }, [clearTimers]);

  const performSignOut = useCallback(async () => {
    clearTimers();
    setShowWarning(false);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {}
    try { sessionStorage.clear(); } catch {}
    window.location.href = '/';
  }, [clearTimers]);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (showWarning) {
      setShowWarning(false);
      setCountdown(COUNTDOWN_SECONDS);
    }
    startTimers();
  }, [showWarning, startTimers]);

  const signOutNow = useCallback(() => {
    performSignOut();
  }, [performSignOut]);

  // Track user activity — only when authenticated
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];

    // Don't track inactivity if user isn't authenticated
    if (!document.cookie.includes('sb-')) return;
    const handler = () => {
      lastActivityRef.current = Date.now();
    };

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    startTimers();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      clearTimers();
    };
  }, [startTimers, clearTimers]);

  // Handle visibility change (tab hidden/visible)
  useEffect(() => {
    if (!document.cookie.includes('sb-')) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // When user returns to tab, check if they've been gone too long
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed >= INACTIVITY_LOGOUT_MS) {
          performSignOut();
        } else {
          startTimers();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [performSignOut, startTimers]);

  return { showWarning, countdown, resetActivity, signOutNow };
}
