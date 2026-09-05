import { describe, it, expect } from 'vitest';
import { buildExportCsv, exportFilenameStem } from '@/lib/export/csv';

describe('lib/export/csv', () => {
  it('builds a CSV with a header row, data rows, and a grand-total row', () => {
    const csv = buildExportCsv({
      title: 'Rebalance Plan — Buffett (Value)',
      subtitle: 'Cash-only deployment',
      thesis: 'Deploy idle cash into value ETFs.',
      rows: [
        { ticker: 'VTI', company: 'Vanguard Total Stock Market', action: 'buy', qty: 2, amountUsd: 520, price: 260, lineTotal: 520, note: 'core equity' },
        { ticker: 'SCHD', company: 'Schwab US Dividend Equity', action: 'buy', amountUsd: 480, price: 80, lineTotal: 480, note: null },
      ],
    });

    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('Ticker,Company,Action,Qty,Amount ($),Price ($),Line Total ($),Notes');
    expect(lines[1]).toContain('VTI');
    expect(lines[1]).toContain('Vanguard Total Stock Market');
    expect(lines[1]).toContain('Buy');
    // 520 + 480 = 1000 grand total
    expect(lines[lines.length - 1]).toContain('Grand Total');
    expect(lines[lines.length - 1]).toContain('1000');
  });

  it('escapes fields containing commas and quotes', () => {
    const csv = buildExportCsv({
      title: 'T',
      rows: [{ ticker: 'BRK.B', company: 'Berkshire Hathaway, Inc. "Class B"', action: 'hold', note: 'long, "term" hold' }],
    });
    const line = csv.trimEnd().split('\n')[1];
    expect(line).toContain('"Berkshire Hathaway, Inc. ""Class B"""');
    expect(line).toContain('"long, ""term"" hold"');
  });

  it('excludes nulls and uses the grandTotal override when provided', () => {
    const csv = buildExportCsv({
      title: 'T',
      grandTotal: 999,
      rows: [{ ticker: 'AAPL', action: 'buy', amountUsd: 100 }],
    });
    const last = csv.trimEnd().split('\n').pop()!;
    expect(last).toContain('999');
  });

  it('produces a safe filename stem', () => {
    expect(exportFilenameStem('Rebalance Plan — Buffett (Value)')).toBe('rebalance-plan-buffett-value');
    expect(exportFilenameStem('   ')).toBe('vantage-export');
    expect(exportFilenameStem('A!B@C#D')).toBe('a-b-c-d');
  });
});
