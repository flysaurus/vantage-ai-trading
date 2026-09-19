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

import { crossedBand } from '@/lib/noticed/bands';

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

/**
 * Build a `SYMBOL → crossing` map from ACTIVE positions.
 *
 * Why this exists (Task 9, Part 6): the badge feed used to be driven purely by
 * `position_milestone` NOTICED items, which are per-crossing EVENTS — they are
 * written once and then marked `resolved`, so `/api/ai/noticed` (which returns
 * `resolved = false` only) stops carrying them and the badge vanished from
 * every surface even while the position was still past its band.
 *
 * A crossing badge is a statement about the CURRENT position, not about a past
 * event, so it is derived from the live P&L % against the SAME band ladder the
 * trigger engine uses (lib/noticed/bands.ts) — which is also what
 * `reuse the same underlying trigger data already computed for target-return
 * thresholds` means in practice. Only the most extreme crossed band per symbol
 * is kept, matching the engine's own collapse rule.
 */
export function computeThresholdCrossings(
  positions:
    | Array<{ symbol?: string | null; totalPnlPercent?: number | null }>
    | null
    | undefined,
  opts?: { targetReturnPct?: number | null; targetLossPct?: number | null },
): Record<string, ThresholdCrossing> {
  const out: Record<string, ThresholdCrossing> = {};
  for (const pos of positions || []) {
    const symbol = String(pos?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const pnl = Number(pos?.totalPnlPercent);
    if (!Number.isFinite(pnl)) continue;
    const band = crossedBand(pnl, opts?.targetReturnPct ?? null, opts?.targetLossPct ?? null);
    if (band == null || band === 0) continue;
    const tone: 'gain' | 'loss' = band > 0 ? 'gain' : 'loss';
    out[symbol] = {
      symbol,
      threshold: band,
      currentPnlPct: Math.round(pnl * 10) / 10,
      tone,
      text: formatThresholdBadge(band, tone),
      // No noticed item backs a live-derived crossing; keep the id null rather
      // than pointing at an event row that may no longer exist.
      itemId: null,
    };
  }
  return out;
}

/** "$12.4K" / "$430" — compact, one decimal at/above $1K. Signed. */
export function formatUsdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * ONE-LINE rollup for the Noticed feed header (milestone option (a)).
 *
 * A crossing only ever renders as a pill on the position it belongs to
 * (threshold-badge.ts), so the *aggregate* — "how many positions crossed, and
 * is it net a gain?" — has no home on the feed today. This is that line.
 *
 * Count comes from the same live map the Holdings badges use (never the noticed
 * event log), so the two can't disagree about membership. Dollars come from each
 * crossing position's `totalPnl`; a position with no finite dollar P&L just
 * doesn't contribute (the count still counts it — it DID cross). Returns null
 * when nothing has crossed, so the caller renders nothing.
 */
export function formatCrossingSummary(
  positions:
    | Array<{ symbol?: string | null; totalPnl?: number | null }>
    | null
    | undefined,
  bySymbol: Record<string, ThresholdCrossing> | null | undefined,
): string | null {
  const symbols = Object.keys(bySymbol || {});
  const count = symbols.length;
  if (count === 0) return null;

  const dollars = new Map<string, number>();
  for (const p of positions || []) {
    const s = String(p?.symbol || '').trim().toUpperCase();
    const v = Number(p?.totalPnl);
    if (s && Number.isFinite(v)) dollars.set(s, v);
  }

  let gains = 0;
  let losses = 0;
  for (const s of symbols) {
    const v = dollars.get(s);
    if (v == null) continue;
    if (bySymbol![s].tone === 'gain') gains += v;
    else losses += v;
  }

  const bits = [`${count} position${count === 1 ? '' : 's'} crossed a target`];
  if (gains > 0) bits.push(`+${formatUsdCompact(gains)}`);
  if (losses < 0) bits.push(formatUsdCompact(losses));
  return bits.join(' · ');
}

/** O(1) lookup helper that tolerates an undefined map. */
export function crossingFor(
  map: Record<string, ThresholdCrossing> | null | undefined,
  symbol: string | null | undefined,
): ThresholdCrossing | null {
  if (!map || !symbol) return null;
  return map[symbol.toUpperCase()] || null;
}
