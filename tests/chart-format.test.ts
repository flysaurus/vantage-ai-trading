import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────
// "Server pre-formats every number" contract.
//
// The chart renderers must never format a number themselves: every value a
// user can read arrives as a preformatted STRING from chart-registry.ts.
// Numeric fields exist for geometry only (bar widths, ring angles, bubble
// positions). Two ways this file enforces that:
//   1. static source scan of components/charts/*.tsx
//   2. registry output assertions (incl. the waterfall, whose lib needs a
//      broker connection — stubbed here)
// ─────────────────────────────────────────────────────────────────

vi.mock('@/lib/portfolio/pnl-waterfall', () => ({
  buildPnlWaterfall: async () => ({
    steps: [
      { label: 'Start (unknown)', delta: null, kind: 'start' },
      { label: 'Contributions', delta: 5000, kind: 'contrib' },
      { label: 'Fees', delta: -12.5, kind: 'fee' },
      { label: 'Current value', delta: 8350, kind: 'end' },
    ],
    unknownStart: true,
    windowStart: '2024-01-01',
    note: 'Window is limited by available activity history.',
  }),
}));

vi.mock('@/lib/portfolio/value-series', () => ({
  CHART_RANGES: ['1D', '1W', '1M', 'YTD', 'ALL'],
  isChartRange: (v: unknown) => ['1D', '1W', '1M', 'YTD', 'ALL'].includes(String(v)),
  buildPortfolioValueSeries: async () => ({
    points: [
      { timestamp: 1_700_000_000_000, value: 8_000 },
      { timestamp: 1_700_600_000_000, value: 8_350 },
    ],
  }),
}));

import { resolveChart, type ChartCtx } from '@/lib/ai/chart-registry';

function fixture(overrides: Partial<ChartCtx> = {}): ChartCtx {
  return {
    positions: [
      { symbol: 'AAPL', qty: 10, price: 200, marketValue: 2000, avgCost: 150, unrealizedPnl: 500, sector: 'Technology' },
      { symbol: 'JNJ', qty: 20, price: 160, marketValue: 3200, avgCost: 170, unrealizedPnl: -200, sector: 'Healthcare' },
      { symbol: 'XOM', qty: 15, price: 110, marketValue: 1650, avgCost: 100, unrealizedPnl: 150, sector: 'Energy' },
    ],
    cash: 1500,
    equity: 8350,
    totalPnl: 450,
    totalPnlPercent: 5.4,
    dayPnl: 120,
    dayPnlPercent: 1.5,
    buyingPower: 1500,
    riskTolerance: 'Moderate',
    investorStyle: 'lynch',
    holdingsUnavailable: false,
    accountId: 'acct-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    supabase: null,
    ...overrides,
  };
}

const CHARTS_DIR = path.join(process.cwd(), 'components', 'charts');

describe('server pre-formats every number (no client formatting)', () => {
  it('no chart component formats a number or bundles a locale formatter', () => {
    const files = fs.readdirSync(CHARTS_DIR).filter((f) => f.endsWith('.tsx'));
    expect(files.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(CHARTS_DIR, f), 'utf8');
      for (const pattern of [/toFixed\(/, /toLocaleString\(/, /Intl\.NumberFormat/]) {
        if (pattern.test(src)) offenders.push(`${f}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('bar items carry display strings (single + grouped)', async () => {
    const health = await resolveChart('health-subscores', fixture());
    const hItems = (health!.data as { items: Array<{ value: number; display: string }> }).items;
    expect(hItems.length).toBeGreaterThan(0);
    for (const it of hItems) {
      expect(it.display).toMatch(/^\d+(\.\d+)?%$/);
      expect(Number.isFinite(it.value)).toBe(true); // geometry still numeric
    }

    const weights = await resolveChart('sector-weights', fixture());
    for (const it of (weights!.data as { items: Array<{ display: string }> }).items) {
      expect(it.display).toMatch(/^\d+(\.\d+)?%$/);
    }

    const drift = await resolveChart('sector-vs-target', fixture());
    const dItems = (
      drift!.data as { items: Array<{ current: number; target: number; currentDisplay: string; targetDisplay: string }> }
    ).items;
    expect(dItems.length).toBeGreaterThan(0);
    for (const it of dItems) {
      expect(it.currentDisplay).toMatch(/^\d+(\.\d+)?%$/);
      expect(it.targetDisplay).toMatch(/^\d+(\.\d+)?%$/);
      expect(Number.isFinite(it.current)).toBe(true);
      expect(Number.isFinite(it.target)).toBe(true);
    }
  });

  it('donut + treemap labels are preformatted', async () => {
    const donut = await resolveChart('allocation-by-sector', fixture());
    const slices = (donut!.data as { slices: Array<{ pct: number; pctDisplay: string }> }).slices;
    expect(slices.length).toBeGreaterThan(0);
    for (const s of slices) {
      expect(s.pctDisplay).toMatch(/^\d+%$/);
      expect(Number.isFinite(s.pct)).toBe(true); // arc geometry
    }

    const treemap = await resolveChart('allocation-treemap', fixture());
    const nodes = (treemap!.data as { nodes: Array<{ size: number; pctDisplay: string }> }).nodes;
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.pctDisplay).toMatch(/^\d+%$/);
      expect(Number.isFinite(n.size)).toBe(true); // tile area
    }
  });

  it('scatter tooltip values are preformatted', async () => {
    const chart = await resolveChart('risk-return', fixture());
    const points = (
      chart!.data as {
        points: Array<{ x: number; y: number; size: number; xDisplay: string; yDisplay: string; sizeDisplay: string }>;
      }
    ).points;
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.xDisplay).toMatch(/^[+-]?\d+(\.\d)?%$/);
      expect(p.yDisplay).toMatch(/^\d+\.\d{2}$/);
      expect(p.sizeDisplay).toMatch(/^\d+(\.\d)?%$/);
      // numbers kept for the plot coordinates
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.size)).toBe(true);
    }
  });

  it('waterfall preformats every delta and keeps the unknown start a LABEL', async () => {
    const chart = await resolveChart('pnl-waterfall', fixture());
    expect(chart).not.toBeNull();
    const steps = (
      chart!.data as { steps: Array<{ label: string; kind: string; delta: number | null; display: string | null }> }
    ).steps;

    const start = steps.find((s) => s.kind === 'start')!;
    expect(start.display).toBeNull(); // never a synthesised starting balance
    expect(start.delta).toBeNull();

    const contrib = steps.find((s) => s.kind === 'contrib')!;
    expect(contrib.display).toBe('+$5,000.00');

    const fee = steps.find((s) => s.kind === 'fee')!;
    expect(fee.display).toBe('−$12.50'); // U+2212 minus, matching fmtSignedUsd

    const end = steps.find((s) => s.kind === 'end')!;
    expect(end.display).toBe('$8,350.00');
  });

  it('stat callouts were always server strings', async () => {
    const chart = await resolveChart('total-value', fixture());
    const data = chart!.data as { value: string; context: string };
    expect(data.value).toBe('$8,350.00');
    expect(typeof data.context).toBe('string');
  });
});
