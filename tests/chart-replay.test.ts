// Legacy chart replay — pure client helpers.
import { describe, it, expect } from 'vitest';
import { buildChartResolvePayload, selectChartHealCandidates } from '@/lib/ai/chart-replay';

describe('buildChartResolvePayload', () => {
  it('returns null with no account (never a zeroed portfolio)', () => {
    expect(buildChartResolvePayload(null)).toBeNull();
    expect(buildChartResolvePayload(undefined)).toBeNull();
  });

  it('maps positions with price falling back to avgCost and pnl from totalPnl', () => {
    const out = buildChartResolvePayload({
      equity: 1000,
      cash: 50,
      positions: [
        { symbol: 'KO', name: 'Coca-Cola', sector: 'Consumer Staples', qty: 3, price: null, avgCost: 60, marketValue: 180, totalPnl: 12, buyDate: '2026-01-01', type: 'stock' },
      ],
    })!;
    expect(out.equity).toBe(1000);
    expect(out.cash).toBe(50);
    expect(out.positions[0]).toMatchObject({
      symbol: 'KO', name: 'Coca-Cola', sector: 'Consumer Staples', qty: 3, price: 60, marketValue: 180, avgCost: 60, unrealizedPnl: 12, buyDate: '2026-01-01', type: 'stock',
    });
  });

  it('keeps an UNKNOWN cash as null — never a fabricated 0', () => {
    expect(buildChartResolvePayload({ equity: 10, cash: null, positions: [] })!.cash).toBeNull();
    expect(buildChartResolvePayload({ equity: 10, positions: [] })!.cash).toBeNull();
    expect(buildChartResolvePayload({ equity: 10, cash: NaN, positions: [] })!.cash).toBeNull();
  });

  it('keeps a real 0 cash as 0', () => {
    expect(buildChartResolvePayload({ equity: 10, cash: 0, positions: [] })!.cash).toBe(0);
  });

  it('defaults name to the symbol and missing numbers to 0', () => {
    const p = buildChartResolvePayload({ equity: 0, cash: 0, positions: [{ symbol: 'SPY' }] })!.positions[0];
    expect(p.name).toBe('SPY');
    expect(p.qty).toBe(0);
    expect(p.marketValue).toBe(0);
  });
});

describe('selectChartHealCandidates', () => {
  const ai = (over: any = {}) => ({ role: 'ai', content: 'x [CHART:waterfall|pnl-waterfall]', id: 'm1', ...over });

  it('picks an AI message whose stored content carries a marker', () => {
    expect(selectChartHealCandidates([ai()])).toEqual([
      { id: 'm1', content: 'x [CHART:waterfall|pnl-waterfall]' },
    ]);
  });

  it('skips messages that already have charts (no redundant work)', () => {
    expect(selectChartHealCandidates([ai({ charts: [{ type: 'waterfall', key: 'k' }] })])).toEqual([]);
  });

  it('skips messages with no marker at all', () => {
    expect(selectChartHealCandidates([ai({ content: 'plain prose, no chart' })])).toEqual([]);
  });

  it('skips user messages, even if they quote a marker', () => {
    expect(selectChartHealCandidates([ai({ role: 'user' })])).toEqual([]);
  });

  it('requires an id (a heal write needs a row to target)', () => {
    expect(selectChartHealCandidates([ai({ id: '' })])).toEqual([]);
    expect(selectChartHealCandidates([ai({ id: undefined })])).toEqual([]);
  });

  it('returns newest-first and respects the cap', () => {
    const msgs = [1, 2, 3, 4].map((n) => ai({ id: `m${n}` }));
    expect(selectChartHealCandidates(msgs, 2).map((c) => c.id)).toEqual(['m4', 'm3']);
  });

  it('tolerates junk entries', () => {
    expect(selectChartHealCandidates([null as any, undefined as any, ai()] as any)).toHaveLength(1);
  });
});
