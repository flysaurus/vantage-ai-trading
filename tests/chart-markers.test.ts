import { describe, expect, it } from 'vitest';
import {
  CHART_TYPES,
  isChartType,
  parseChartRequests,
  resolveCharts,
  stripChartMarkers,
  validateChartRequests,
} from '@/lib/ai/chart-markers';
import { CHART_KEYS, type ChartCtx } from '@/lib/ai/chart-registry';

const EMPTY_CTX: ChartCtx = {
  positions: [],
  cash: 0,
  equity: 0,
  totalPnlPercent: 0,
  holdingsUnavailable: true,
};

describe('chart marker grammar', () => {
  it('is the closed set of 7 chart types — no heatmap, no inferred type', () => {
    expect(CHART_TYPES).toEqual([
      'bar',
      'bar-grouped',
      'donut',
      'line',
      'treemap',
      'scatter',
      'waterfall',
    ]);
    expect(CHART_TYPES).not.toContain('heatmap');
    expect(isChartType('heatmap')).toBe(false);
    expect(isChartType('donut')).toBe(true);
  });

  it('parses one marker per type plus a stat callout', () => {
    const text = [
      '[CHART:bar|health-subscores]',
      '[CHART:bar-grouped|sector-vs-target]',
      '[CHART:donut|allocation-by-position]',
      '[CHART:line|portfolio-value|1M]',
      '[CHART:treemap|allocation-treemap]',
      '[CHART:scatter|risk-return]',
      '[CHART:waterfall|pnl-waterfall]',
      '[STAT:total-pnl]',
    ].join('\n');

    const reqs = parseChartRequests(text);
    expect(reqs).toHaveLength(8);
    expect(reqs.map((r) => r.type)).toEqual([
      'bar',
      'bar-grouped',
      'donut',
      'line',
      'treemap',
      'scatter',
      'waterfall',
      'stat',
    ]);
    expect(reqs[3].param).toBe('1M');
    expect(reqs[7].kind).toBe('stat');
    expect(reqs[7].key).toBe('total-pnl');
  });

  it('carries a key, never a value', () => {
    const [req] = parseChartRequests('[CHART:bar|sector-weights]');
    expect(req.key).toBe('sector-weights');
    // The marker text contains no numeric payload at all.
    expect(req.raw).not.toMatch(/\d/);
  });

  it('dedupes identical markers and keeps distinct keys', () => {
    expect(parseChartRequests('[CHART:bar|sector-weights] [CHART:bar|sector-weights]')).toHaveLength(1);
    expect(parseChartRequests('[CHART:bar|sector-weights][CHART:donut|allocation-by-sector]')).toHaveLength(2);
  });

  it('drops malformed markers at parse: unknown type, no key, extra segments', () => {
    expect(parseChartRequests('[CHART:sankey|sector-weights]')).toHaveLength(0);
    expect(parseChartRequests('[CHART:bar]')).toHaveLength(0);
    expect(parseChartRequests('[CHART:bar|sector-weights|1M|extra]')).toHaveLength(0);
    expect(parseChartRequests('[CHART:bar|')).toHaveLength(0);
  });

  it('keeps an unknown KEY so validation can reject it explicitly', () => {
    const reqs = parseChartRequests('[CHART:bar|moon-phase]');
    expect(reqs).toHaveLength(1);
    const { valid, stripAll } = validateChartRequests(reqs, CHART_KEYS);
    expect(valid).toHaveLength(0);
    expect(stripAll).toHaveLength(1);
  });
});

describe('chart marker validation', () => {
  it('accepts every catalog key with its canonical type', () => {
    const text = Object.entries(CHART_KEYS)
      .map(([key, entry]) =>
        entry.type === 'stat' ? `[STAT:${key}]` : `[CHART:${entry.type}|${key}]`,
      )
      .join('\n');
    const { valid, stripAll } = validateChartRequests(parseChartRequests(text), CHART_KEYS);
    expect(stripAll).toHaveLength(0);
    expect(valid).toHaveLength(Object.keys(CHART_KEYS).length);
  });

  it('rejects a type/key mismatch (the registry owns the canonical type)', () => {
    const { valid, stripAll } = validateChartRequests(
      parseChartRequests('[CHART:donut|health-subscores]'),
      CHART_KEYS,
    );
    expect(valid).toHaveLength(0);
    expect(stripAll).toHaveLength(1);
  });

  it('rejects a chart marker used as a stat and vice versa', () => {
    const a = validateChartRequests(parseChartRequests('[STAT:sector-weights]'), CHART_KEYS);
    const b = validateChartRequests(parseChartRequests('[CHART:bar|total-pnl]'), CHART_KEYS);
    expect(a.valid).toHaveLength(0);
    expect(a.stripAll).toHaveLength(1);
    expect(b.valid).toHaveLength(0);
    expect(b.stripAll).toHaveLength(1);
  });

  it('rejects empty keys', () => {
    const { valid, stripAll } = validateChartRequests(
      parseChartRequests('[CHART:bar|] [STAT:]'),
      CHART_KEYS,
    );
    expect(valid).toHaveLength(0);
    expect(stripAll.length).toBeGreaterThan(0);
  });

  it('has no heatmap or correlation key anywhere in the catalog', () => {
    for (const key of Object.keys(CHART_KEYS)) {
      expect(key).not.toMatch(/heatmap|correlat/i);
    }
    const { valid, stripAll } = validateChartRequests(
      parseChartRequests('[CHART:bar|sector-correlation] [STAT:correlation-score]'),
      CHART_KEYS,
    );
    expect(valid).toHaveLength(0);
    expect(stripAll).toHaveLength(2);
  });
});

describe('stripping chart markers', () => {
  it('strips every marker so the prose stands', () => {
    const text = [
      'Your largest position is AAPL at 24% of the account.',
      '[CHART:bar|sector-weights]',
      '[STAT:largest-position]',
    ].join('\n');
    const out = stripChartMarkers(text);
    expect(out).toBe('Your largest position is AAPL at 24% of the account.');
    expect(out).not.toMatch(/\[CHART:|\[STAT:/);
  });

  it('strips malformed and truncated markers too', () => {
    expect(stripChartMarkers('Answer. [CHART:sankey|nope] [CHART:bar|')).toBe('Answer.');
    expect(stripChartMarkers('Answer. [STAT:')).toBe('Answer.');
    expect(stripChartMarkers('Answer. [CHART:bar]')).toBe('Answer.');
  });

  it('leaves prose and a markdown table untouched (no hierarchy between them)', () => {
    const text = [
      'Here is the breakdown.',
      '',
      '| Sub-score | Value |',
      '| --- | --- |',
      '| Diversification | 71 |',
      '',
      '[CHART:bar|health-subscores]',
    ].join('\n');
    const out = stripChartMarkers(text);
    expect(out).toContain('| Diversification | 71 |');
    expect(out).toContain('Here is the breakdown.');
    expect(out).not.toContain('[CHART:');
  });

  it('returns the text unchanged when there is no marker', () => {
    expect(stripChartMarkers('No visuals here.')).toBe('No visuals here.');
  });
});

describe('resolution failures never produce a chart', () => {
  it('resolves nothing when the data is unavailable, and the marker strips to prose', async () => {
    const text = 'You have 4 positions. [CHART:donut|allocation-by-position]';
    const charts = await resolveCharts(parseChartRequests(text), EMPTY_CTX);
    expect(charts).toHaveLength(0);
    expect(stripChartMarkers(text)).toBe('You have 4 positions.');
  });

  it('returns nothing for a response with no markers', async () => {
    expect(await resolveCharts(parseChartRequests('Just prose.'), EMPTY_CTX)).toHaveLength(0);
  });

  it('never throws, even when every marker is bogus', async () => {
    const reqs = parseChartRequests(
      '[CHART:bar|nope] [CHART:sankey|nope] [STAT:nope] [CHART:line|portfolio-value|9X]',
    );
    const charts = await resolveCharts(reqs, EMPTY_CTX);
    expect(charts).toHaveLength(0);
  });
});
