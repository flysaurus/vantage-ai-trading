// ─── Insights/Holdings: threshold-crossing badges ───────────
// Target-return / target-loss crossings used to be LIST items ("crossed +250%
// total return threshold…"). They are not a list item any more: a crossing is
// only meaningful next to the position it belongs to, so it renders as an
// inline pill on that position's row.
//
// This module does NOT re-implement trigger logic. It reads the
// `position_milestone` noticed items the engine already produced
// (lib/noticed/engine.ts findNewTriggers → meta { symbol, threshold,
// currentPnlPct, marketValue, action }) and turns them into a symbol-keyed
// badge map the position rows can look up in O(1).
//
// Only rows with an ACTIVE crossing get a badge — most rows get none.

/** Shape returned by the engine for `position_milestone` items. */
export interface ThresholdCrossing {
  /** Ticker the badge belongs to (upper-case). */
  symbol: string;
  /** The crossed band, e.g. +250 or -20 (signed). */
  threshold: number;
  /** Latest total-return % for the position, when the engine provided it. */
  currentPnlPct: number | null;
  tone: 'gain' | 'loss';
  /** Ready-to-render pill text, e.g. "▲ crossed +250%". */
  text: string;
  /** Noticed-item id, for analytics/dismissal wiring. */
  itemId: string | null;
}

/** Pill copy for a crossing: "▼ crossed -20%" / "▲ crossed +250%". */
export function formatThresholdBadge(
  threshold: number,
  tone: 'gain' | 'loss',
): string {
  const arrow = tone === 'gain' ? '▲' : '▼';
  const sign = threshold > 0 ? '+' : '';
  return `${arrow} crossed ${sign}${threshold}%`;
}

function symbolOf(item: any): string {
  const raw = item?.meta?.symbol;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase();
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  return (title.split(/[\s—:-]+/)[0] || '').toUpperCase();
}

/**
 * Build a `SYMBOL → crossing` map from active noticed items.
 *
 * A symbol that crossed several bands keeps its most extreme crossing (the
 * engine already collapses to the widest band per run, but a stored history can
 * hold more than one row — the widest one is the honest headline).
 */
export function thresholdCrossings(
  items: any[] | null | undefined,
): Record<string, ThresholdCrossing> {
  const out: Record<string, ThresholdCrossing> = {};
  for (const item of items || []) {
    if (!item || item.triggerType !== 'position_milestone') continue;
    const symbol = symbolOf(item);
    if (!symbol) continue;

    const threshold = Number(item?.meta?.threshold);
    if (!Number.isFinite(threshold) || threshold === 0) continue;

    const cur = Number(item?.meta?.currentPnlPct);
    const tone: 'gain' | 'loss' = threshold > 0 ? 'gain' : 'loss';
    const next: ThresholdCrossing = {
      symbol,
      threshold,
      currentPnlPct: Number.isFinite(cur) ? cur : null,
      tone,
      text: formatThresholdBadge(threshold, tone),
      itemId: item.id != null ? String(item.id) : null,
    };

    const prev = out[symbol];
    if (!prev || Math.abs(next.threshold) > Math.abs(prev.threshold)) {
      out[symbol] = next;
    }
  }
  return out;
}

/** O(1) lookup helper that tolerates an undefined map. */
export function crossingFor(
  map: Record<string, ThresholdCrossing> | null | undefined,
  symbol: string | null | undefined,
): ThresholdCrossing | null {
  if (!map || !symbol) return null;
  return map[symbol.toUpperCase()] || null;
}
