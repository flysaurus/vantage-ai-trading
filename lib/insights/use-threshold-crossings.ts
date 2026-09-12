// ─── Shared threshold-crossing source (client hook) ──────────
// ONE place that answers "which positions crossed a threshold today?" so the
// Holdings badges (components/portfolio/PortfolioTab.tsx) and the Insights
// rollup (components/insights/InsightsTab.tsx) can never disagree about
// membership. The chat "Explore" picker reads the separate NOTICED feed
// (/api/ai/noticed) — that feed is a historical log, so its wording may differ,
// but the live set of crossings must come from here.
//
// Pure client module — no server imports.

import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { computeThresholdCrossings, type ThresholdCrossing } from './threshold-badge';

export interface TargetThresholds {
  targetReturnPct: number | null;
  targetLossPct: number | null;
}

/** The user's own target-return/-loss percentages (null = default ladder). */
export function useTargetThresholds(): TargetThresholds {
  const [targets, setTargets] = useState<TargetThresholds>({
    targetReturnPct: null,
    targetLossPct: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet('/api/user/preferences');
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setTargets({
          targetReturnPct: typeof j?.target_return_pct === 'number' ? j.target_return_pct : null,
          targetLossPct: typeof j?.target_loss_pct === 'number' ? j.target_loss_pct : null,
        });
      } catch { /* default ladder */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return targets;
}

/**
 * symbol → the most extreme band that position has crossed. Same computation
 * the Holdings badges use; empty object when nothing has crossed.
 */
export function useThresholdCrossings(
  positions: Array<{ symbol?: string; totalPnlPercent?: number | null }> | null | undefined,
  targets?: TargetThresholds,
): {
  bySymbol: Record<string, ThresholdCrossing>;
  symbols: string[];
  count: number;
} {
  const t = useTargetThresholds();
  const targetReturnPct = targets ? targets.targetReturnPct : t.targetReturnPct;
  const targetLossPct = targets ? targets.targetLossPct : t.targetLossPct;

  const bySymbol = useMemo(
    () => computeThresholdCrossings((positions || []) as any, { targetReturnPct, targetLossPct }),
    [positions, targetReturnPct, targetLossPct],
  );

  const symbols = useMemo(() => Object.keys(bySymbol), [bySymbol]);
  return { bySymbol, symbols, count: symbols.length };
}
