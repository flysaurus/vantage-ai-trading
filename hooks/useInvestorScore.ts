// ─── useInvestorScore ────────────────────────────────────────
// Client hook for displaying the Investor Score.
//
// Returns: score, level, progress, nextThreshold, loading.
// Refreshes on gamification events via custom event listener.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import type { ScoreResult } from '@/lib/investor-score/calculate';

const EMPTY_RESULT: ScoreResult = {
  score: 0,
  level: 'Apprentice',
  levelIndex: 0,
  nextThreshold: 100,
  progress: 0,
  breakdown: {
    baskets: 0,
    trades: 0,
    aiSessions: 0,
    streak: 0,
    styleConsistency: 150,
    riskAdherence: 100,
  },
};

export interface UseInvestorScoreReturn {
  score: number;
  level: string;
  levelIndex: number;
  progress: number; // 0-100% within current level
  nextThreshold: number | null;
  breakdown: ScoreResult['breakdown'];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useInvestorScore(): UseInvestorScoreReturn {
  const [result, setResult] = useState<ScoreResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  const { user } = useAuth();

  const fetchScore = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const userId = user?.id || '';
      if (!userId) {
        setResult(EMPTY_RESULT);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/investor-score', { credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonymousId: userId }),
        method: 'POST',
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (data.score) {
        setResult(data.score);
      }
    } catch (err: any) {
      console.error('[useInvestorScore] Fetch error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Fetch on mount / when user ID becomes available
  useEffect(() => {
    const userId = user?.id || '';
    if (!userId) return;
    fetchScore();
  }, [fetchScore, user?.id]);

  // Listen for gamification events to refresh
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === 'score_updated' || detail?.type === 'milestone_earned') {
        // Debounce: refresh after a short delay
        setTimeout(() => fetchScore(), 1000);
      }
    };

    window.addEventListener('vantage-gamification', handler);
    return () => window.removeEventListener('vantage-gamification', handler);
  }, [fetchScore]);

  return {
    score: result.score,
    level: result.level,
    levelIndex: result.levelIndex,
    progress: result.progress,
    nextThreshold: result.nextThreshold,
    breakdown: result.breakdown,
    loading,
    error,
    refetch: fetchScore,
  };
}
