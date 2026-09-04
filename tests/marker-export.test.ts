import { describe, it, expect } from 'vitest';
import { buildMarkerExportPayload } from '../lib/export/marker-export';

describe('buildMarkerExportPayload', () => {
  it('extracts rows from a single [PORTFOLIO:{...}] block', () => {
    const text = `[SUMMARY_TLDR: $10k across 2 positions]
[PORTFOLIO:{"total":10000,"strategy":"Growth","positions":[{"symbol":"VTI","amount":6000},{"symbol":"IJR","amount":1500}]}]
VTI [RECOMMEND:VTI:BUY:$6000] anchors the portfolio while IJR [RECOMMEND:IJR:BUY:$1500] adds a small-cap tilt.`;

    const payload = buildMarkerExportPayload(text);
    expect(payload).not.toBeNull();
    expect(payload!.title).toBe('Growth');
    expect(payload!.rows).toHaveLength(2);
    expect(payload!.rows[0]).toMatchObject({ ticker: 'VTI', action: 'buy', amountUsd: 6000 });
    expect(payload!.rows[1]).toMatchObject({ ticker: 'IJR', action: 'buy', amountUsd: 1500 });
    expect(payload!.grandTotal).toBe(10000);
  });

  it('excludes CASH / reserve positions', () => {
    const text = `[PORTFOLIO:{"total":5000,"strategy":"Cash Tilt","positions":[{"symbol":"VOO","amount":4000},{"symbol":"CASH","amount":1000,"isReserve":true}]}]`;
    const payload = buildMarkerExportPayload(text)!;
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].ticker).toBe('VOO');
    expect(payload.grandTotal).toBe(5000);
  });

  it('handles sell sides and enriches company/thesis from [POSITION:{...}]', () => {
    const text = `[PORTFOLIO:{"total":2000,"strategy":"Rebalance","positions":[{"symbol":"AAPL","amount":2000,"side":"sell"}]}]
[POSITION:{"ticker":"AAPL","name":"Apple Inc.","thesis":"Trim the winner."}]`;
    const payload = buildMarkerExportPayload(text)!;
    expect(payload.rows[0]).toMatchObject({
      ticker: 'AAPL',
      action: 'sell',
      amountUsd: 2000,
      company: 'Apple Inc.',
      note: 'Trim the winner.',
    });
  });

  it('falls back to [RECOMMEND:...] markers when no PORTFOLIO block present', () => {
    const text = 'Buy MSFT [RECOMMEND:MSFT:BUY:$500] and NVDA [RECOMMEND:NVDA:BUY:$1000].';
    const payload = buildMarkerExportPayload(text)!;
    expect(payload.title).toBe('Recommendations');
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows[0]).toMatchObject({ ticker: 'MSFT', action: 'buy', amountUsd: 500 });
    expect(payload.grandTotal).toBe(1500);
  });

  it('strips foreign exchange suffixes', () => {
    const text = '[RECOMMEND:SAP.DE:BUY:$300]';
    const payload = buildMarkerExportPayload(text)!;
    expect(payload.rows[0].ticker).toBe('SAP');
  });

  it('returns null for prose with no markers', () => {
    expect(buildMarkerExportPayload('Just some advice, no tickers or blocks.')).toBeNull();
  });

  it('returns null for a multi-strategy response with empty positions', () => {
    expect(buildMarkerExportPayload('[PORTFOLIO:{"total":1000,"strategy":"Empty","positions":[]}]')).toBeNull();
  });
});
