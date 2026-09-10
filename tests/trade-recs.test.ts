import { describe, it, expect } from 'vitest';
import { detectTradeRecommendations, formatTradeRec } from '@/lib/ai/trade-recs';

describe('detectTradeRecommendations — structured trade cards', () => {
  it('pairs each quantity with its OWN ticker in a multi-trade reply', () => {
    const reply =
      "Your ETF sleeve has drifted: SPY is now 41% of the portfolio. " +
      "Trim 18 shares of SPY ($12,450) and trim 240 shares of XLF ($9,180), then add 31 shares of VTI ($9,610) with the proceeds.";
    const recs = detectTradeRecommendations(reply);
    expect(recs.map((r) => [r.ticker, r.side, r.shares])).toEqual([
      ['SPY', 'trim', 18],
      ['XLF', 'trim', 240],
      ['VTI', 'buy', 31],
    ]);
    expect(recs[0].amount).toBe(12450);
  });

  it('accepts an exact dollar-only instruction', () => {
    const recs = detectTradeRecommendations('Trim $12,450 from SPY to bring it back to a 30% weight.');
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ ticker: 'SPY', side: 'trim', amount: 12450 });
  });

  it('handles one quantity applied to two tickers', () => {
    const recs = detectTradeRecommendations('Sell 25 shares of XLF and QQQ to raise cash.');
    expect(recs.map((r) => r.ticker).sort()).toEqual(['QQQ', 'XLF']);
    expect(recs.every((r) => r.shares === 25 && r.side === 'trim')).toBe(true);
  });

  it('ignores prose with no concrete quantity', () => {
    expect(detectTradeRecommendations('You may want to reduce your ETF concentration over time.')).toEqual([]);
  });

  it('ignores questions', () => {
    expect(detectTradeRecommendations('Should I trim 18 shares of SPY?')).toEqual([]);
  });

  it('ignores hypotheticals', () => {
    expect(detectTradeRecommendations('For example, if you were to sell 10 shares of SPY you would raise cash.')).toEqual([]);
  });

  it('does not mistake ordinary uppercase words for tickers', () => {
    expect(detectTradeRecommendations('Buy 100 shares of THE ETF and hold it.')).toEqual([]);
    expect(detectTradeRecommendations('BUY 50 SHARES OF CASH')).toEqual([]);
  });

  it('formats a human one-liner', () => {
    expect(formatTradeRec({ ticker: 'SPY', side: 'trim', shares: 18, note: '' })).toBe('Trim 18 shares of SPY');
    expect(formatTradeRec({ ticker: 'VTI', side: 'buy', amount: 9610, note: '' })).toBe('Buy $9,610 of VTI');
  });
});
