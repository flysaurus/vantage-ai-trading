// ─── useInactivity — Auto-logout after inactivity ─────────────
// After INACTIVITY_WARNING_MS of inactivity → shows warning modal
// After INACTIVITY_LOGOUT_MS (2 min countdown) → force signs out
//
// Defaults: 8 min warning / 10 min logout. Overridable for testing via
// NEXT_PUBLIC_INACTIVITY_WARNING_MS / NEXT_PUBLIC_INACTIVITY_LOGOUT_MS (ms).
//
// Usage: const { showWarning, countdown, resetActivity, signOutNow } = useInactivity();

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

const INACTIVITY_WARNING_MS = Number(process.env.NEXT_PUBLIC_INACTIVITY_WARNING_MS) || 8 * 60 * 1000;
const INACTIVITY_LOGOUT_MS = Number(process.env.NEXT_PUBLIC_INACTIVITY_LOGOUT_MS) || 10 * 60 * 1000;
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
  const [isAuthed, setIsAuthed] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for stable access inside event handlers (avoid stale closures)
  const startTimersRef = useRef<() => void>(() => {});
  const showWarningRef = useRef(false);
  const lastTimerRestartRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
  }, []);

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

  const startTimers = useCallback(() => {
    clearTimers();

    const timeSinceActivity = Date.now() - lastActivityRef.current;
    const remainingToWarning = Math.max(0, INACTIVITY_WARNING_MS - timeSinceActivity);
    const remainingToLogout = Math.max(0, INACTIVITY_LOGOUT_MS - timeSinceActivity);

    // Schedule warning at 8 min (countdown effect handles ticking)
    if (remainingToWarning > 0) {
      warningTimerRef.current = setTimeout(() => {
        showWarningRef.current = true;
        setShowWarning(true);
        setCountdown(COUNTDOWN_SECONDS);
      }, remainingToWarning);
    }

    // Schedule auto-logout at 10 min
    logoutTimerRef.current = setTimeout(() => {
      performSignOut();
    }, remainingToLogout);
  }, [clearTimers, performSignOut]);

  // Keep refs in sync for stable event handler access
  useEffect(() => { startTimersRef.current = startTimers; }, [startTimers]);
  useEffect(() => { showWarningRef.current = showWarning; }, [showWarning]);

  // Auth-state gate — replaces the fragile `document.cookie.includes('sb-')`
  // check (which silently fails if the Supabase session cookie is HttpOnly, or
  // if the user signs in via SPA navigation without a hard reload).
  // onAuthStateChange fires INITIAL_SESSION from cookies on mount, so isAuthed
  // resolves correctly whether the user is already signed in or signs in later.
  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setIsAuthed(!!data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setIsAuthed(!!session);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isAuthed) {
      console.log(`[useInactivity] armed — warning ${Math.round(INACTIVITY_WARNING_MS / 60000)}m / logout ${Math.round(INACTIVITY_LOGOUT_MS / 60000)}m`);
    }
  }, [isAuthed]);

  // ── Countdown ticker (separate effect, React-managed) ──
  useEffect(() => {
    if (!showWarning) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          performSignOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [showWarning, performSignOut]);

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

  // Track user activity — restarts idle timer on every interaction.
  // Registered on `document` with `capture: true` so events originating in
  // child containers are caught. This matters because the AI chat scrolls inside
  // its own overflow container, and `scroll` does NOT bubble to `window` — a user
  // wheel-scrolling a long response would otherwise generate zero tracked events
  // and get force-signed-out while actively reading. `wheel`, `pointer*`, `click`,
  // `input`, and `focus` are tracked explicitly for the same reason.
  useEffect(() => {
    const events = [
      'mousedown', 'mousemove', 'mouseup', 'click',
      'keydown', 'keyup',
      'pointerdown', 'pointermove', 'pointerup',
      'touchstart', 'touchmove',
      'scroll', 'wheel',
      'input', 'focus',
    ];

    // Don't track inactivity if user isn't authenticated
    if (!isAuthed) return;

    const handler = () => {
      lastActivityRef.current = Date.now();

      // Throttle timer restarts to once per 5s (avoid churn on mousemove)
      const now = Date.now();
      if (now - lastTimerRestartRef.current < 5000) return;
      lastTimerRestartRef.current = now;

      // If warning is already showing, dismiss it and restart
      if (showWarningRef.current) {
        showWarningRef.current = false;
        setShowWarning(false);
        setCountdown(COUNTDOWN_SECONDS);
      }
      startTimersRef.current();
    };

    events.forEach((e) => document.addEventListener(e, handler, { capture: true, passive: true }));
    startTimers();

    return () => {
      events.forEach((e) => document.removeEventListener(e, handler, { capture: true }));
      clearTimers();
    };
  }, [startTimers, clearTimers, isAuthed]);

  // Handle visibility change (tab hidden/visible)
  useEffect(() => {
    if (!isAuthed) return;

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
  }, [performSignOut, startTimers, isAuthed]);

  return { showWarning, countdown, resetActivity, signOutNow };
}
