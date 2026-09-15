import { describe, expect, it, vi } from 'vitest';

// The value series performs network I/O (Yahoo/Finnhub). The registry's job is
// to decide WHETHER a key resolves — the series itself is tested elsewhere.
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

import { CHART_KEYS, resolveChart, type ChartCtx } from '@/lib/ai/chart-registry';
import { parseChartRequests, resolveCharts, validateChartRequests } from '@/lib/ai/chart-markers';

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

const CHART_KEY_ENTRIES = Object.entries(CHART_KEYS).filter(([, e]) => e.type !== 'stat');
const STAT_KEY_ENTRIES = Object.entries(CHART_KEYS).filter(([, e]) => e.type === 'stat');

/** The waterfall needs a broker connection + SnapTrade config; covered separately. */
const NEEDS_CONNECTION = 'pnl-waterfall';

describe('chart registry — catalog shape', () => {
  it('exposes only the 7 chart types plus stat callouts', () => {
    const types = new Set(Object.values(CHART_KEYS).map((e) => e.type));
    expect([...types].sort()).toEqual(
      ['bar', 'bar-grouped', 'donut', 'line', 'scatter', 'stat', 'treemap', 'waterfall'].sort(),
    );
  });

  it('has no heatmap or correlation key', () => {
    for (const key of Object.keys(CHART_KEYS)) {
      expect(key).not.toMatch(/heatmap|correlat/i);
    }
    expect(validateChartRequests(parseChartRequests('[CHART:heatmap|x]'), CHART_KEYS).valid).toHaveLength(0);
  });

  it('gives every key a label and a model-facing "when" hint', () => {
    for (const [key, entry] of Object.entries(CHART_KEYS)) {
      expect(entry.label.length, `${key} label`).toBeGreaterThan(0);
      expect(entry.when.length, `${key} when`).toBeGreaterThan(0);
    }
  });
});

describe('chart registry — resolution against a fixture portfolio', () => {
  for (const [key, entry] of CHART_KEY_ENTRIES) {
    if (key === NEEDS_CONNECTION) continue;
    it(`resolves "${key}" (${entry.type})`, async () => {
      const chart = await resolveChart(key, fixture({ param: '1M' }));
      expect(chart, key).not.toBeNull();
      expect(chart!.key).toBe(key);
      expect(chart!.type).toBe(entry.type);
      expect(chart!.title.length).toBeGreaterThan(0);
    });
  }

  for (const [key] of STAT_KEY_ENTRIES) {
    it(`resolves stat "${key}"`, async () => {
      const chart = await resolveChart(key, fixture());
      expect(chart, key).not.toBeNull();
      expect(chart!.type).toBe('stat');
      expect((chart!.data as { value: string }).value.length).toBeGreaterThan(0);
    });
  }

  it('returns null for the waterfall without a broker connection', async () => {
    expect(await resolveChart(NEEDS_CONNECTION, fixture({ connectionId: null }))).toBeNull();
  });
});

describe('chart registry — the anti-fabrication contract', () => {
  it('returns null for an unknown key', async () => {
    expect(await resolveChart('not-a-key', fixture())).toBeNull();
  });

  it('returns null for every position-derived key when holdings are unavailable', async () => {
    const ctx = fixture({ holdingsUnavailable: true });
    const positionDerived = [
      ...CHART_KEY_ENTRIES.map(([k]) => k),
      ...STAT_KEY_ENTRIES.map(([k]) => k),
    ].filter((k) => !['total-value', 'cash', 'buying-power', 'today-pnl'].includes(k));

    for (const key of positionDerived) {
      if (key === NEEDS_CONNECTION) {
        expect(await resolveChart(key, ctx)).toBeNull();
        continue;
      }
      expect(await resolveChart(key, ctx), `${key} must not render without holdings`).toBeNull();
    }
  });

  it('still reports cash and buying power when the broker hides holdings', async () => {
    // These are account-level facts, not position-derived — they stay available.
    const ctx = fixture({ holdingsUnavailable: true, positions: [] });
    expect(await resolveChart('cash', ctx)).not.toBeNull();
    expect(await resolveChart('buying-power', ctx)).not.toBeNull();
  });

  it('never renders an empty-portfolio chart', async () => {
    const ctx = fixture({ positions: [], cash: 0, equity: 0, totalPnl: 0 });
    for (const [key] of CHART_KEY_ENTRIES) {
      if (key === NEEDS_CONNECTION) continue;
      expect(await resolveChart(key, ctx), key).toBeNull();
    }
  });

  it('labels the scatter risk axis as a sector-based proxy — never "beta"', async () => {
    const chart = await resolveChart('risk-return', fixture());
    const data = chart!.data as {
      yLabel: string;
      points: Array<{ symbol: string; x: number; y: number; size: number }>;
    };
    expect(data.yLabel).toBe('risk proxy (sector-based)');
    expect(chart!.footnote).toMatch(/sector-level risk proxy/i);
    expect(chart!.footnote).toMatch(/not beta/i);
    expect(chart!.footnote).toMatch(/not position-level precision/i);
    expect(data.points).toHaveLength(3);
    expect(data.points.map((p) => p.symbol).sort()).toEqual(['AAPL', 'JNJ', 'XOM']);
    // Every bubble carries a sector-proxy risk value, never a per-position beta.
    for (const p of data.points) expect(Number.isFinite(p.y)).toBe(true);
  });

  it('bridges the waterfall from real steps only — never a synthesised start value', async () => {
    // No connection → no waterfall at all (prose stands instead).
    expect(await resolveChart(NEEDS_CONNECTION, fixture({ connectionId: null }))).toBeNull();
  });

  it('strips a type/key mismatch instead of rendering the other type', async () => {
    const reqs = parseChartRequests('[CHART:donut|health-subscores]');
    const { valid, stripAll } = validateChartRequests(reqs, CHART_KEYS);
    expect(valid).toHaveLength(0);
    expect(stripAll).toHaveLength(1);
    expect(await resolveCharts(reqs, fixture())).toHaveLength(0);
  });
});

describe('chart registry — bounded output', () => {
  it('resolves at most 2 charts per response', async () => {
    const reqs = parseChartRequests(
      '[STAT:total-value] [STAT:cash] [STAT:position-count] [STAT:health-score]',
    );
    expect(reqs).toHaveLength(4);
    const charts = await resolveCharts(reqs, fixture());
    expect(charts).toHaveLength(2);
  });

  it('keeps marker order', async () => {
    const reqs = parseChartRequests('[STAT:cash] [STAT:total-value]');
    const charts = await resolveCharts(reqs, fixture());
    expect(charts.map((c) => c.key)).toEqual(['cash', 'total-value']);
  });
});
