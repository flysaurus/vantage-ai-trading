// ─── MilestoneContext ────────────────────────────────────────
// Global context that manages the milestone toast queue.
//
// Listens for vantage-gamification CustomEvents (emitted by
// lib/gamification/events.ts) and enqueues milestone toasts.
//
// Also exposes triggerMilestone(key) for programmatic use.
//
// Queue behavior:
// - Shows one toast at a time
// - 4s display, 500ms gap before next
// - Never shows same milestone twice per session (deduplication Set)

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { MILESTONE_DEFINITIONS } from '@/lib/gamification/milestones';
import type { MilestoneDef } from '@/lib/gamification/milestones';

// ─── Types ────────────────────────────────────────────────────

export interface MilestoneToastEntry {
  def: MilestoneDef;
  /** Timestamp when this toast was triggered (for stable keys) */
  triggerId: string;
}

interface MilestoneContextValue {
  /** The currently-displayed toast, or null */
  currentToast: MilestoneToastEntry | null;
  /** Programmatically trigger a milestone toast */
  triggerMilestone: (key: string) => void;
  /** Dismiss the current toast early */
  dismissCurrent: () => void;
  /** Number of queued toasts waiting behind current */
  queuedCount: number;
}

// ─── Constants ───────────────────────────────────────────────

const TOAST_DURATION = 4000; // 4s display
const TOAST_GAP = 500; // ms between toasts

// ─── Context ─────────────────────────────────────────────────

const MilestoneContext = createContext<MilestoneContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────

export function MilestoneToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentToast, setCurrentToast] =
    useState<MilestoneToastEntry | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

  // Deduplication: track all milestone keys shown this session
  const shownKeys = useRef<Set<string>>(new Set());

  // Queue of pending toasts
  const queue = useRef<MilestoneToastEntry[]>([]);
  const isProcessing = useRef(false);

  // ── Queue processor ───────────────────────────────────
  const processNext = useCallback(() => {
    if (queue.current.length === 0) {
      isProcessing.current = false;
      setCurrentToast(null);
      setQueuedCount(0);
      return;
    }

    const next = queue.current.shift()!;
    setCurrentToast(next);
    setQueuedCount(queue.current.length);

    // Auto-dismiss after TOAST_DURATION
    const dismissTimer = setTimeout(() => {
      setCurrentToast(null);

      // Gap before next toast
      setTimeout(() => {
        processNext();
      }, TOAST_GAP);
    }, TOAST_DURATION);

    // Store timer ref for early dismiss
    (window as any).__vantage_toast_timer = dismissTimer;
  }, []);

  // ── Add milestone to queue ────────────────────────────
  const triggerMilestone = useCallback(
    (key: string) => {
      // Deduplicate within session
      if (shownKeys.current.has(key)) return;

      const def = MILESTONE_DEFINITIONS[key];
      if (!def) return;

      shownKeys.current.add(key);

      const entry: MilestoneToastEntry = {
        def,
        triggerId: `${key}-${Date.now()}`,
      };

      queue.current.push(entry);
      setQueuedCount(queue.current.length);

      if (!isProcessing.current) {
        isProcessing.current = true;
        processNext();
      }
    },
    [processNext]
  );

  // ── Dismiss current toast early ───────────────────────
  const dismissCurrent = useCallback(() => {
    const timer = (window as any).__vantage_toast_timer;
    if (timer) {
      clearTimeout(timer);
      (window as any).__vantage_toast_timer = null;
    }
    setCurrentToast(null);
    setTimeout(() => processNext(), TOAST_GAP);
  }, [processNext]);

  // ── Listen for gamification events from events.ts ─────
  useEffect(() => {
    function handleGamificationEvent(e: CustomEvent) {
      const { type, payload } = e.detail || {};
      if (type === 'milestone_earned' && payload?.milestoneKey) {
        triggerMilestone(payload.milestoneKey);
      }
      // Also dispatch a custom event for ScoreDetailSheet to refresh
      window.dispatchEvent(new CustomEvent('vantage-score-updated'));
    }

    window.addEventListener(
      'vantage-gamification',
      handleGamificationEvent as EventListener
    );

    return () => {
      window.removeEventListener(
        'vantage-gamification',
        handleGamificationEvent as EventListener
      );
    };
  }, [triggerMilestone]);

  return (
    <MilestoneContext.Provider
      value={{ currentToast, triggerMilestone, dismissCurrent, queuedCount }}
    >
      {children}
    </MilestoneContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────

export function useMilestoneToast(): MilestoneContextValue {
  const ctx = useContext(MilestoneContext);
  if (!ctx) {
    throw new Error(
      'useMilestoneToast must be used within <MilestoneToastProvider>'
    );
  }
  return ctx;
}
