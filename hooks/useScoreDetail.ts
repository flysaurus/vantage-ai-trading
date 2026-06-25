// ─── useScoreDetail ──────────────────────────────────────────
// Data-fetching hook for the Score Detail Sheet.
// Fires a single fetch when the sheet opens, returns all
// sections: score hero, stats row, chart history, milestones.
//
// Loading: true while fetching, skeleton shown in sheet.
// Error: non-fatal, sheet shows whatever data arrived.

'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { MILESTONE_DEFINITIONS } from '@/lib/gamification/milestones';
import type { ScoreSnapshot } from '@/lib/investor-score/snapshot';

// ─── Types ────────────────────────────────────────────────────

export interface ScoreStats {
  baskets: number;
  trades: number;
  aiChats: number;
  days: number;
}

export interface MilestoneEntry {
  key: string;
  label: string;
  description: string;
  icon: string;
  awardedAt?: string;
}

export interface ScoreDetailData {
  score: number;
  level: string;
  levelIndex: number;
  progress: number;
  nextThreshold: number | null;
  stats: ScoreStats;
  history: ScoreSnapshot[];
  milestones: MilestoneEntry[];
  lockedMilestones: MilestoneEntry[];
}

export interface UseScoreDetailReturn {
  data: ScoreDetailData | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_DATA: ScoreDetailData = {
  score: 0,
  level: 'Apprentice',
  levelIndex: 0,
  progress: 0,
  nextThreshold: 100,
  stats: { baskets: 0, trades: 0, aiChats: 0, days: 0 },
  history: [],
  milestones: [],
  lockedMilestones: [],
};

// ─── Hook ────────────────────────────────────────────────────

export function useScoreDetail(open: boolean): UseScoreDetailReturn {
  const [data, setData] = useState<ScoreDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!open) {
      // Reset fetch gate when sheet closes
      fetchedRef.current = false;
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        const userId = user?.id || '';
        if (!userId) {
          if (!cancelled) setData(EMPTY_DATA);
          return;
        }

        // Fire all fetches in parallel
        const [scoreRes, milestonesRes] = await Promise.all([
          fetch('/api/investor-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anonymousId: userId }),
          }),
          fetch(
            `/api/gamification/milestones?anonymousId=${encodeURIComponent(userId)}`
          ),
        ]);

        if (cancelled) return;

        // Parse score data
        let scoreData: any = null;
        if (scoreRes.ok) {
          const scoreJson = await scoreRes.json();
          scoreData = scoreJson.score;
        }

        // Parse milestones
        let earnedMilestones: { key: string; awarded_at: string }[] = [];
        if (milestonesRes.ok) {
          const mJson = await milestonesRes.json();
          earnedMilestones = mJson.milestones || [];
        }

        // Parse history from score data
        const history: ScoreSnapshot[] = scoreData?.history || [];

        // Build milestone entries
        const earnedKeys = new Set(earnedMilestones.map((m: any) => m.key));
        const earnedEntries: MilestoneEntry[] = earnedMilestones.map((m: any) => {
          const def = MILESTONE_DEFINITIONS[m.key];
          return {
            key: m.key,
            label: def?.label || m.key,
            description: def?.description || '',
            icon: def?.icon || '🏅',
            awardedAt: m.awarded_at,
          };
        });

        // Locked milestones (up to 3 for teaser)
        const lockedEntries: MilestoneEntry[] = Object.values(MILESTONE_DEFINITIONS)
          .filter((def) => !earnedKeys.has(def.key))
          .slice(0, 3)
          .map((def) => ({
            key: def.key,
            label: def.label,
            description: def.description,
            icon: def.icon,
          }));

        // Stats
        const stats: ScoreStats = {
          baskets: scoreData?.baskets_created || 0,
          trades: scoreData?.trades_executed || 0,
          aiChats: scoreData?.ai_sessions || 0,
          days: scoreData?.current_streak || 0,
        };

        const result: ScoreDetailData = {
          score: scoreData?.score ?? 0,
          level: scoreData?.level ?? 'Apprentice',
          levelIndex: scoreData?.levelIndex ?? 0,
          progress: scoreData?.progress ?? 0,
          nextThreshold: scoreData?.nextThreshold ?? 100,
          stats,
          history,
          milestones: earnedEntries,
          lockedMilestones: lockedEntries,
        };

        if (!cancelled) setData(result);
      } catch (err: any) {
        if (!cancelled) {
          console.error('[useScoreDetail] Fetch error:', err.message);
          setError(err.message);
          setData(EMPTY_DATA);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();

    return () => {
      cancelled = true;
    };
  }, [open]);

  return { data, loading, error };
}
