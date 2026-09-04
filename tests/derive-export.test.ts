import { describe, it, expect } from 'vitest';
import { deriveDownloadPayload } from '@/lib/export/derive-export';

describe('deriveDownloadPayload', () => {
  it('derives a payload from [PORTFOLIO:{...}] markers', () => {
    const content = [
      'Here is a build:',
      '[PORTFOLIO:{"strategy":"Aggressive Growth","total":10000,"positions":[{"symbol":"VTI","amount":6000,"side":"buy"},{"symbol":"AAPL","amount":4000,"side":"buy"},{"symbol":"CASH","amount":0,"isReserve":true}]}]',
    ].join('\n');
    const payload = deriveDownloadPayload(content);
    expect(payload).not.toBeNull();
    expect(payload!.title).toBe('Aggressive Growth');
    expect(payload!.rows.map((r) => r.ticker)).toEqual(['VTI', 'AAPL']);
    expect(payload!.grandTotal).toBe(10000);
  });

  it('derives from a rebalance table WITH a Target column', () => {
    const content = [
      "Here's the rebalance plan to **Lynch (Growth)** — realign to growth targets.",
      '',
      '| Action | Symbol | Holding | Amount | Target |',
      '|:---|:---|:---|:---|:---|',
      '| Buy | **VTI** | Vanguard Total Market | $5,000 | 40% |',
      '| Sell | **AAPL** | Apple Inc. | $2,000 | 10% |',
      '',
      '**Summary:** 2 trades — $5,000 to buy · $2,000 to sell.',
    ].join('\n');
    const payload = deriveDownloadPayload(content);
    expect(payload).not.toBeNull();
    expect(payload!.title).toBe('Rebalance Plan — Lynch (Growth)');
    expect(payload!.rows).toHaveLength(2);
    expect(payload!.rows[0]).toMatchObject({
      ticker: 'VTI',
      company: 'Vanguard Total Market',
      action: 'buy',
      amountUsd: 5000,
    });
    expect(payload!.rows[1]).toMatchObject({
      ticker: 'AAPL',
      company: 'Apple Inc.',
      action: 'sell',
      amountUsd: 2000,
    });
    expect(payload!.grandTotal).toBe(7000);
  });

  it('derives from a rebalance table WITHOUT a Target column', () => {
    const content = [
      'Ready to execute the **cash-only** rebalance to **Buffett (Value)** — 2 buys:',
      '',
      '| Action | Symbol | Holding | Amount |',
      '|:---|:---|:---|:---|',
      '| Buy | **BRK.B** | Berkshire Hathaway | $3,500 |',
      '| Buy | **VTI** | Vanguard Total Market | $1,500 |',
    ].join('\n');
    const payload = deriveDownloadPayload(content);
    expect(payload).not.toBeNull();
    expect(payload!.rows).toHaveLength(2);
    expect(payload!.rows.every((r) => r.action === 'buy')).toBe(true);
    expect(payload!.grandTotal).toBe(5000);
  });

  it('ignores prose-only content (returns null)', () => {
    const content = 'Your portfolio looks well balanced. Nothing to change right now.';
    expect(deriveDownloadPayload(content)).toBeNull();
  });

  it('does not misread unrelated markdown tables', () => {
    const content = [
      'Here is a comparison:',
      '',
      '| Metric | Value |',
      '|:---|:---|',
      '| P/E | 22.5 |',
      '| Yield | 1.8% |',
    ].join('\n');
    expect(deriveDownloadPayload(content)).toBeNull();
  });
});
