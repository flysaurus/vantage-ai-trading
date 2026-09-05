import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildExportWorkbook, exportFilenameStem } from '@/lib/export/xlsx';

describe('lib/export/xlsx', () => {
  it('builds a valid xlsx buffer with Summary + Allocation sheets', async () => {
    const buf = await buildExportWorkbook({
      title: 'Rebalance Plan — Buffett (Value)',
      subtitle: 'Cash-only deployment — no sells',
      thesis: 'Deploy available cash into the value-style core ETFs.',
      rows: [
        { ticker: 'VTI', company: 'Total US Market', action: 'buy', amountUsd: 6000, note: 'Core base' },
        { ticker: 'SCHD', company: 'Dividend Growth', action: 'buy', amountUsd: 2500 },
        { ticker: 'INTC', company: 'Intel', action: 'sell', qty: 10, price: 25, lineTotal: 250 },
      ],
    });

    expect(buf.length).toBeGreaterThan(0);
    // .xlsx is a ZIP archive — first two bytes are PK.
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Allocation']);

    const ws = wb.getWorksheet('Allocation')!;
    expect(ws.getCell('A1').value).toBe('Ticker');
    expect(ws.getCell('A2').value).toBe('VTI');
    expect(ws.getCell('C2').value).toBe('Buy');
    // Grand total row: 6000 + 2500 + 250 = 8750
    expect(ws.getCell('G5').value).toBe(8750);
  });

  it('writes the FULL thesis into the Summary sheet', async () => {
    const thesis = 'Deploy available cash across the value-style core ETFs, favoring broad-market and dividend-growth exposure while keeping the barbell tilt toward quality. This keeps fees low and maintains the target drift bands.';
    const buf = await buildExportWorkbook({
      title: 'Rebalance Plan',
      thesis,
      rows: [{ ticker: 'VTI', action: 'buy', amountUsd: 100 }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const summary = wb.getWorksheet('Summary')!;
    // The full thesis text must be present, un-truncated.
    const values = summary.getColumn(1).values as unknown[];
    const joined = values.map((v) => (v && typeof v === 'object' && 'text' in v ? (v as { text: string }).text : v == null ? '' : String(v))).join('|');
    expect(joined).toContain(thesis);
  });

  it('defaults grand total to the sum of line totals', async () => {
    const buf = await buildExportWorkbook({
      title: 'Test',
      rows: [
        { ticker: 'A', action: 'buy', amountUsd: 100 },
        { ticker: 'B', action: 'buy', amountUsd: 200 },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Allocation')!;
    expect(ws.getCell('G4').value).toBe(300);
  });

  it('sanitizes title into a filename stem', () => {
    expect(exportFilenameStem('Rebalance Plan — Buffett (Value)')).toBe('rebalance-plan-buffett-value');
    expect(exportFilenameStem('   ')).toBe('vantage-export');
    expect(exportFilenameStem('A!B@C#D')).toBe('a-b-c-d');
  });
});
