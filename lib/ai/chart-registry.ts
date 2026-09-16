// ═══════════════════════════════════════════════════════════════
// lib/ai/chart-registry.ts — the ONLY source of chart keys + data
// ═══════════════════════════════════════════════════════════════
//
// Every key maps to a canonical TYPE and a RESOLVER that computes real data
// from libs the UI already trusts. The model never supplies a number: it asks
// for a key and the server fills in the value.
//
// 20 keys across the 7 types + the STAT kind (the spec's table lists 9 chart
// keys + 11 stat keys; its "17" header is an arithmetic slip — the table is the
// source of truth). NO correlation/heatmap key or type exists here, by design —
// that is explicitly out of scope.

import { computePortfolioHealth, sectorBeta } from '@/lib/insights/health-score';
import { STYLE_SECTOR_TARGETS } from '@/lib/sector-targets';
import type { AssetMix, MixPosition } from '@/lib/portfolio/sector-mix';
import { resolveSectorMix } from '@/lib/portfolio/sector-mix-server';
import {
  buildPortfolioValueSeries,
  isChartRange,
  type ValueSeriesPosition,
} from '@/lib/portfolio/value-series';
import { buildPnlWaterfall } from '@/lib/portfolio/pnl-waterfall';

// ── Types ─────────────────────────────────────────────────────

/** The fixed, enumerated chart type set. Nothing is inferred from data shape. */
export type ChartType = 'bar' | 'bar-grouped' | 'donut' | 'line' | 'treemap' | 'scatter' | 'waterfall';

/** One parsed marker. `type` is the marker's declared type (or 'stat'). */
export interface ChartRequest {
  kind: 'chart' | 'stat';
  type: ChartType | 'stat';
  key: string;
  param?: string;
  raw: string;
}

/** A position as the chat route forwards it (client-supplied, sanitized). */
export interface ChartPosition {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  qty?: number;
  price?: number;
  marketValue: number;
  avgCost?: number | null;
  unrealizedPnl?: number | null;
  /** Pre-computed total return %, when the client supplied one. */
  totalPnlPct?: number | null;
  buyDate?: string | null;
  type?: string | null;
}

/**
 * Everything a resolver may read. All numbers here come from the client's
 * portfolio payload (itself sourced from the live broker), never from the model.
 */
export interface ChartCtx {
  positions: ChartPosition[];
  /** Settled cash. `null` = the payload carried no cash figure (unknown). */
  cash: number | null;
  /**
   * False when `snapshot.cash` was absent/non-numeric. Charts that divide by a
   * cash-derived total must then report unknown instead of assuming 0 — a
   * fabricated 0 reads as "no cash" and, worse, "100% invested".
   */
  cashKnown?: boolean;
  equity: number;
  /** Total unrealised P&L; derived from positions when omitted. */
  totalPnl?: number;
  totalPnlPercent: number;
  /** Today's P&L; omitted when the account payload does not carry it. */
  dayPnl?: number;
  dayPnlPercent?: number;
  buyingPower?: number | null;
  riskTolerance?: string | null;
  investorStyle?: string | null;
  /** True when the live account could not be loaded — every position-derived
   *  key then resolves to null (marker is stripped, prose stands). */
  holdingsUnavailable?: boolean;
  supabase?: any;
  /** Bound by `resolveCharts` from the marker's `|<param>` segment. */
  param?: string;
  // Identifiers the P&L waterfall needs (SnapTrade activities are per-account).
  accountId?: string | null;
  userId?: string | null;
  connectionId?: string | null;
}

/** What a resolver returns: the data plus optional presentation metadata. */
export interface ChartResolveResult {
  data: any;
  title?: string;
  subtitle?: string;
  footnote?: string;
}

export interface ChartKeyEntry {
  type: ChartType | 'stat';
  label: string;
  /** Model-facing hint — when this key is the right visual. */
  when: string;
  resolve: (ctx: ChartCtx) => Promise<ChartResolveResult | null>;
}

/** A fully-resolved chart, ready to send to the client. */
export interface ResolvedChart {
  type: ChartType | 'stat';
  key: string;
  title: string;
  subtitle?: string;
  footnote?: string;
  data: any;
}

// ── Shared palette (existing --v-* tokens only; both themes read) ──
const PALETTE = [
  'var(--v-accent)',
  'var(--v-hero-gain)',
  'var(--v-hero-warn)',
  'var(--v-hero-accent)',
  'var(--v-loss)',
  'var(--v-violet-label)',
];
const OTHER_COLOR = 'var(--v-text-faint)';

// ── Formatting ────────────────────────────────────────────────
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function fmtUsd(n: number): string {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSignedUsd(n: number): string {
  return `${n >= 0 ? '+' : '−'}${fmtUsd(n)}`;
}
function fmtPct(n: number, digits = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}
/** Unsigned percent LABEL for a bar row / legend (1 dp, trailing .0 dropped). */
function fmtPctLabel(n: number): string {
  return `${round1(n)}%`;
}
/** Unsigned whole-percent LABEL for a compact legend / tile (0 dp). */
function fmtPct0Label(n: number): string {
  return `${Math.round(n)}%`;
}

// ── Position helpers ──────────────────────────────────────────
function investable(ctx: ChartCtx): ChartPosition[] {
  return (ctx.positions || []).filter((p) => (p.marketValue || 0) > 0);
}

function positionPnlPct(p: ChartPosition): number {
  if (typeof p.totalPnlPct === 'number' && Number.isFinite(p.totalPnlPct)) return p.totalPnlPct;
  const cost = (p.avgCost ?? 0) * (p.qty ?? 0);
  const pnl =
    typeof p.unrealizedPnl === 'number' && Number.isFinite(p.unrealizedPnl)
      ? p.unrealizedPnl
      : p.marketValue - cost;
  return cost > 0 ? (pnl / cost) * 100 : 0;
}

function positionPnl(p: ChartPosition): number {
  if (typeof p.unrealizedPnl === 'number' && Number.isFinite(p.unrealizedPnl)) return p.unrealizedPnl;
  return p.marketValue - (p.avgCost ?? 0) * (p.qty ?? 0);
}

function healthFor(ctx: ChartCtx) {
  return computePortfolioHealth({
    positions: investable(ctx).map((p) => ({
      symbol: p.symbol,
      marketValue: p.marketValue,
      sector: p.sector ?? null,
    })),
    // Pass unknowns through as unknown; the scorer flags the result partial
    // rather than scoring a fabricated "cash 0 / return 0".
    cash: ctx.cashKnown === false ? null : ctx.cash,
    totalPnlPercent: typeof ctx.totalPnlPercent === 'number' && Number.isFinite(ctx.totalPnlPercent)
      ? ctx.totalPnlPercent
      : null,
    riskTolerance: ctx.riskTolerance,
  });
}

async function mixFor(ctx: ChartCtx): Promise<AssetMix> {
  const positions: MixPosition[] = investable(ctx).map((p) => ({
    symbol: p.symbol,
    sector: p.sector ?? null,
    value: p.marketValue,
  }));
  return resolveSectorMix(positions, ctx.supabase, 12);
}

function accountTotal(ctx: ChartCtx): number {
  return investable(ctx).reduce((s, p) => s + p.marketValue, 0) + (ctx.cash || 0);
}

function derivedTotalPnl(ctx: ChartCtx): number {
  if (typeof ctx.totalPnl === 'number' && Number.isFinite(ctx.totalPnl)) return ctx.totalPnl;
  return investable(ctx).reduce((s, p) => s + positionPnl(p), 0);
}

/** A stat payload — one headline number + a short context line. */
function stat(title: string, value: string, context: string): ChartResolveResult {
  return { title, data: { label: title, value, context } };
}

// ── Registry ──────────────────────────────────────────────────

export const CHART_KEYS: Record<string, ChartKeyEntry> = {
  // ── bar ────────────────────────────────────────────────────
  'health-subscores': {
    type: 'bar',
    label: 'Portfolio health — sub-scores',
    when: 'explaining which of the three health components is dragging the score down',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      if (investable(ctx).length === 0) return null;
      const h = healthFor(ctx);
      return {
        data: {
          unit: '%',
          max: 100,
          items: [
            {
              label: 'Diversification',
              value: h.subScores.diversification,
              display: fmtPctLabel(h.subScores.diversification),
              note: `${h.breakdown.effectiveNames.toFixed(1)} effective names`,
            },
            {
              label: 'Risk balance',
              value: h.subScores.riskBalance,
              display: fmtPctLabel(h.subScores.riskBalance),
              note: `beta ${h.breakdown.beta.toFixed(2)}`,
            },
            ...(h.subScores.returns === null
              ? []
              : [{
                  label: 'Returns',
                  value: h.subScores.returns,
                  display: fmtPctLabel(h.subScores.returns),
                  note: fmtPct(ctx.totalPnlPercent ?? 0),
                }]),
          ],
        },
        subtitle: `Overall ${h.score}/100 — ${h.grade}`,
      };
    },
  },

  'sector-weights': {
    type: 'bar',
    label: 'Sector weights',
    when: 'comparing how much of the book sits in each sector',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const mix = await mixFor(ctx);
      if (mix.total <= 0) return null;
      const top = mix.buckets.slice(0, 7);
      const rest = mix.buckets.slice(7);
      const items = top.map((b) => ({
        label: b.bucket,
        value: round1(b.pct),
        display: fmtPctLabel(b.pct),
      }));
      const restPct = rest.reduce((s, b) => s + b.pct, 0);
      if (restPct > 0.05)
        items.push({ label: 'Other', value: round1(restPct), display: fmtPctLabel(restPct) });
      return {
        data: { unit: '%', items },
        footnote:
          mix.otherSymbols.length > 0
            ? `${mix.otherSymbols.length} holding(s) had no sector on file and are grouped as Other.`
            : undefined,
      };
    },
  },

  // ── bar-grouped ────────────────────────────────────────────
  'sector-vs-target': {
    type: 'bar-grouped',
    label: 'Sector weights vs style target',
    when: 'showing drift — current sector weight beside the style target',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const styleKey = STYLE_SECTOR_TARGETS[(ctx.investorStyle || '').trim().toLowerCase()]
        ? (ctx.investorStyle || '').trim().toLowerCase()
        : 'lynch';
      const targets = STYLE_SECTOR_TARGETS[styleKey];
      const mix = await mixFor(ctx);
      if (mix.total <= 0) return null;
      const labels = new Set<string>();
      for (const b of mix.buckets) labels.add(b.bucket);
      for (const k of Object.keys(targets)) if (k !== 'Cash') labels.add(k);
      const current = new Map(mix.buckets.map((b) => [b.bucket, b.pct]));
      const items = Array.from(labels).map((label) => {
        const cur = round1(current.get(label) ?? 0);
        const tgt = round1(targets[label] ?? 0);
        return {
          label,
          current: cur,
          target: tgt,
          // Preformatted server-side — the client renders these verbatim.
          currentDisplay: fmtPctLabel(cur),
          targetDisplay: fmtPctLabel(tgt),
        };
      });
      const uncovered = Array.from(labels).some((l) => targets[l] == null);
      return {
        data: { unit: '%', currentLabel: 'Current', targetLabel: `Target (${styleKey})`, items },
        footnote: uncovered
          ? 'Targets are style-based and do not cover every bucket — any bucket without a style target reads as 0.'
          : undefined,
      };
    },
  },

  // ── donut ──────────────────────────────────────────────────
  'allocation-by-position': {
    type: 'donut',
    label: 'Allocation by position',
    when: 'showing composition across holdings (≤7 segments)',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const positions = investable(ctx).sort((a, b) => b.marketValue - a.marketValue);
      const total = positions.reduce((s, p) => s + p.marketValue, 0);
      if (total <= 0) return null;
      const slices = positions.slice(0, 6).map((p, i) => {
        const pct = round1((p.marketValue / total) * 100);
        return {
          label: p.symbol,
          value: round2(p.marketValue),
          pct,
          pctDisplay: fmtPct0Label(pct),
          color: PALETTE[i % PALETTE.length],
        };
      });
      const restVal = positions.slice(6).reduce((s, p) => s + p.marketValue, 0);
      if (restVal > 0) {
        const pct = round1((restVal / total) * 100);
        slices.push({
          label: 'Other',
          value: round2(restVal),
          pct,
          pctDisplay: fmtPct0Label(pct),
          color: OTHER_COLOR,
        });
      }
      return { data: { slices, total: round2(total) } };
    },
  },

  'allocation-by-sector': {
    type: 'donut',
    label: 'Allocation by sector',
    when: 'showing sector composition (≤7 segments)',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const mix = await mixFor(ctx);
      if (mix.total <= 0) return null;
      const slices = mix.buckets.slice(0, 6).map((b, i) => {
        const pct = round1(b.pct);
        return {
          label: b.bucket,
          value: round2(b.value),
          pct,
          pctDisplay: fmtPct0Label(pct),
          color: PALETTE[i % PALETTE.length],
        };
      });
      const restPct = mix.buckets.slice(6).reduce((s, b) => s + b.pct, 0);
      if (restPct > 0.05) {
        const pct = round1(restPct);
        slices.push({
          label: 'Other',
          value: 0,
          pct,
          pctDisplay: fmtPct0Label(pct),
          color: OTHER_COLOR,
        });
      }
      return {
        data: { slices, total: round2(mix.total) },
        footnote:
          mix.otherSymbols.length > 0
            ? `${mix.otherSymbols.length} holding(s) had no sector on file and are grouped as Other.`
            : undefined,
      };
    },
  },

  // ── line ───────────────────────────────────────────────────
  'portfolio-value': {
    type: 'line',
    label: 'Portfolio value over time',
    when: 'showing a value trajectory across a time range',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const range = (ctx.param || '1M').toUpperCase();
      if (!isChartRange(range)) return null; // invalid param → strip
      const positions = investable(ctx);
      if (positions.length === 0) return null;

      const seriesPositions: ValueSeriesPosition[] = positions.map((p) => {
        const shares =
          typeof p.qty === 'number' && p.qty > 0 ? p.qty : p.price ? p.marketValue / p.price : 0;
        const avgCost = p.avgCost ?? 0;
        return {
          symbol: p.symbol,
          shares,
          buyDate: p.buyDate ?? undefined,
          avgCost,
          totalCost: shares > 0 && avgCost > 0 ? shares * avgCost : undefined,
        };
      });

      const { points, error } = await buildPortfolioValueSeries(
        seriesPositions,
        ctx.cash || 0,
        range,
      );
      // Short/absent history → no chart (never a partial line).
      if (error || !points || points.length < 2) return null;
      return {
        data: {
          range,
          points: points.map((pt) => ({ timestamp: pt.timestamp, value: pt.value })),
        },
      };
    },
  },

  // ── treemap ────────────────────────────────────────────────
  'allocation-treemap': {
    type: 'treemap',
    label: 'Allocation treemap',
    when: 'composition with 8+ holdings, or value + a second dimension (P&L sign)',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const positions = investable(ctx).sort((a, b) => b.marketValue - a.marketValue);
      const total = positions.reduce((s, p) => s + p.marketValue, 0);
      if (total <= 0) return null;
      const nodes = positions.map((p) => {
        const pnl = positionPnl(p);
        const pct = round1((p.marketValue / total) * 100);
        return {
          name: p.symbol.slice(0, 8),
          label: p.symbol,
          size: round2(p.marketValue),
          pct,
          pctDisplay: fmtPct0Label(pct),
          pnlPct: round1(positionPnlPct(p)),
          colorSign: pnl > 0 ? 'gain' : pnl < 0 ? 'loss' : 'flat',
        };
      });
      return { data: { nodes, total: round2(total) } };
    },
  },

  // ── scatter ────────────────────────────────────────────────
  'risk-return': {
    type: 'scatter',
    label: 'Return vs sector risk proxy',
    when: 'positioning holdings on two axes (return on x, risk proxy on y)',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const positions = investable(ctx);
      const total = positions.reduce((s, p) => s + p.marketValue, 0);
      if (total <= 0 || positions.length === 0) return null;
      const points = positions.map((p) => {
        const x = round1(positionPnlPct(p));
        const y = sectorBeta(p.sector);
        const size = round2((p.marketValue / total) * 100);
        return {
          symbol: p.symbol,
          // Numbers drive GEOMETRY only; these preformatted strings are what
          // the tooltip renders — the client never formats a number itself.
          x,
          y,
          size,
          xDisplay: `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`,
          yDisplay: y.toFixed(2),
          sizeDisplay: `${size.toFixed(1)}%`,
        };
      });
      return {
        data: { points, xLabel: 'total return %', yLabel: 'risk proxy (sector-based)' },
        footnote:
          'The y-axis is a sector-level risk proxy, not beta and not position-level precision — every holding in the same sector shares one value.',
      };
    },
  },

  // ── waterfall ──────────────────────────────────────────────
  'pnl-waterfall': {
    type: 'waterfall',
    label: 'P&L bridge',
    when: 'an additive sequence from a starting point to the current value (contributions, gains, income, fees)',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const res = await buildPnlWaterfall(ctx.accountId ?? '', {
        userId: ctx.userId,
        connectionId: ctx.connectionId,
        equity: ctx.equity,
        supabase: ctx.supabase,
      });
      if (!res) return null;
      // Preformat every step's number server-side. The unknown start stays a
      // LABEL ("start unknown") with a null display — never a synthesised value.
      const steps = res.steps.map((s) => ({
        ...s,
        display:
          s.kind === 'start' || s.delta == null
            ? null
            : s.kind === 'end'
              ? fmtUsd(s.delta)
              : fmtSignedUsd(s.delta),
      }));
      return {
        data: { steps, unknownStart: res.unknownStart, windowStart: res.windowStart },
        footnote: res.note,
      };
    },
  },

  // ── stat ───────────────────────────────────────────────────
  'total-value': {
    type: 'stat',
    label: 'Total value',
    when: 'one headline number: the account total',
    resolve: async (ctx) => {
      const total = ctx.equity || accountTotal(ctx);
      if (!total) return null;
      return stat('Total value', fmtUsd(total), `${investable(ctx).length} position(s)`);
    },
  },

  'total-pnl': {
    type: 'stat',
    label: 'Total P&L',
    when: 'one headline number: unrealised/total profit and loss',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const pnl = derivedTotalPnl(ctx);
      return stat('Total P&L', fmtSignedUsd(pnl), fmtPct(ctx.totalPnlPercent || 0));
    },
  },

  'today-pnl': {
    type: 'stat',
    label: "Today's P&L",
    when: 'one headline number: today’s change',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      if (typeof ctx.dayPnl !== 'number' || !Number.isFinite(ctx.dayPnl)) return null;
      return stat("Today's P&L", fmtSignedUsd(ctx.dayPnl), fmtPct(ctx.dayPnlPercent || 0));
    },
  },

  cash: {
    type: 'stat',
    label: 'Cash',
    when: 'one headline number: settled cash',
    resolve: async (ctx) => {
      if (typeof ctx.cash !== 'number' || !Number.isFinite(ctx.cash)) return null;
      return stat('Cash', fmtUsd(ctx.cash), 'settled cash');
    },
  },

  'buying-power': {
    type: 'stat',
    label: 'Buying power',
    when: 'one headline number: available buying power',
    resolve: async (ctx) => {
      if (typeof ctx.buyingPower !== 'number' || !Number.isFinite(ctx.buyingPower)) return null;
      return stat('Buying power', fmtUsd(ctx.buyingPower), 'available to trade');
    },
  },

  'health-score': {
    type: 'stat',
    label: 'Health score',
    when: 'one headline number: the portfolio health score',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable || investable(ctx).length === 0) return null;
      const h = healthFor(ctx);
      return stat('Health score', `${h.score}/100`, h.grade);
    },
  },

  'position-count': {
    type: 'stat',
    label: 'Positions',
    when: 'one headline number: how many holdings',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const n = investable(ctx).length;
      return stat('Positions', `${n}`, 'holdings in the account');
    },
  },

  'largest-position': {
    type: 'stat',
    label: 'Largest position',
    when: 'one headline number: the biggest holding and its weight',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const positions = investable(ctx);
      const total = positions.reduce((s, p) => s + p.marketValue, 0);
      if (total <= 0) return null;
      const top = positions.reduce((best, p) => (p.marketValue > best.marketValue ? p : best));
      const pct = (top.marketValue / total) * 100;
      return stat(top.symbol, `${pct.toFixed(1)}%`, 'of the account value');
    },
  },

  'top-gainer': {
    type: 'stat',
    label: 'Top gainer',
    when: 'one headline number: the best-returning holding',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const positions = investable(ctx);
      if (positions.length === 0) return null;
      const top = positions.reduce((best, p) => (positionPnlPct(p) > positionPnlPct(best) ? p : best));
      return stat(top.symbol, fmtPct(positionPnlPct(top)), 'best total return');
    },
  },

  'top-loser': {
    type: 'stat',
    label: 'Top loser',
    when: 'one headline number: the worst-returning holding',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable) return null;
      const positions = investable(ctx);
      if (positions.length === 0) return null;
      const worst = positions.reduce((best, p) => (positionPnlPct(p) < positionPnlPct(best) ? p : best));
      return stat(worst.symbol, fmtPct(positionPnlPct(worst)), 'weakest total return');
    },
  },

  'headline-subscore': {
    type: 'stat',
    label: 'Weakest sub-score',
    when: 'one headline number: the health component dragging the score',
    resolve: async (ctx) => {
      if (ctx.holdingsUnavailable || investable(ctx).length === 0) return null;
      const h = healthFor(ctx);
      // A component we could not measure is not a candidate for "weakest".
      const entries: Array<[string, number]> = [
        ['Diversification', h.subScores.diversification],
        ['Risk balance', h.subScores.riskBalance],
        ...(h.subScores.returns === null ? [] : ([['Returns', h.subScores.returns]] as Array<[string, number]>)),
      ];
      const [name, score] = entries.reduce((worst, cur) => (cur[1] < worst[1] ? cur : worst));
      return stat(name, `${score}/100`, 'weakest health component');
    },
  },
};

/**
 * Resolve ONE key through the registry. Returns null for an unknown key, a
 * resolver that returns null, or a resolver that throws — the caller then
 * strips the marker and lets the prose stand.
 */
export async function resolveChart(key: string, ctx: ChartCtx): Promise<ResolvedChart | null> {
  const entry = CHART_KEYS[key];
  if (!entry) return null;
  try {
    const resolved = await entry.resolve(ctx);
    if (!resolved) return null;
    return {
      type: entry.type,
      key,
      title: resolved.title ?? entry.label,
      subtitle: resolved.subtitle,
      footnote: resolved.footnote,
      data: resolved.data,
    };
  } catch {
    return null;
  }
}
