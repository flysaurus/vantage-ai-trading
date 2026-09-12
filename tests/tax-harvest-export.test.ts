// ═══════════════════════════════════════════════════════════════
// tests/tax-harvest-export.test.ts
// Unit tests for the Tax Loss Harvesting (.xlsx) plan export.
//
// Run: npx vitest run tests/tax-harvest-export.test.ts
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildTaxHarvestPlanWorkbook,
  taxHarvestExportFilename,
  washSaleStatusText,
  DEFAULT_TAX_RATE,
  type TaxHarvestPlanExportInput,
} from '@/lib/export/tax-harvest-export';
import { num, CURRENCY_FMT, HEADER_FILL, INK } from '@/lib/export/rebalance-plan-export';

const GENERATED_AT = new Date('2025-12-03T15:04:05.000Z');

const INPUT: TaxHarvestPlanExportInput = {
  accountName: 'Demo Account',
  broker: 'Fidelity',
  environment: 'demo',
  access: 'trading',
  isDemo: false,
  taxYear: 2025,
  positions: [
    {
      symbol: 'INTC',
      name: 'Intel Corporation',
      qty: 100,
      costBasis: 5000.55,
      marketValue: 3765.437,
      unrealizedLoss: -1234.567,
      unrealizedLossPct: -24.687,
      washSaleSafe: true,
    },
    {
      symbol: 'CHWY',
      name: 'Chewy Inc.',
      qty: 40,
      costBasis: 2000,
      marketValue: 1500,
      unrealizedLoss: -500,
      unrealizedLossPct: -25,
      washSaleSafe: false,
      daysSinceLastTrade: 12,
    },
  ],
  generatedAt: GENERATED_AT,
};

async function buildWorkbook(input: TaxHarvestPlanExportInput): Promise<ExcelJS.Workbook> {
  const buffer = await buildTaxHarvestPlanWorkbook(input);
  expect(Buffer.isBuffer(buffer)).toBe(true);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

/** Read a Summary label→value pair (values live in column A label / column B value). */
function summaryValue(ws: ExcelJS.Worksheet, label: string): ExcelJS.CellValue {
  let found: ExcelJS.CellValue = null;
  ws.eachRow((row) => {
    if (String(row.getCell(1).value ?? '').trim() === label) found = row.getCell(2).value;
  });
  return found;
}

describe('buildTaxHarvestPlanWorkbook — structure', () => {
  it('creates a Summary sheet then a Harvest Candidates sheet', async () => {
    const wb = await buildWorkbook(INPUT);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Harvest Candidates']);
  });

  it('freezes the header row on the data sheet', async () => {
    const wb = await buildWorkbook(INPUT);
    const ws = wb.getWorksheet('Harvest Candidates')!;
    expect(ws.views?.[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('writes the exact header row', async () => {
    const wb = await buildWorkbook(INPUT);
    const ws = wb.getWorksheet('Harvest Candidates')!;
    const headers = [1, 2, 3, 4, 5, 6, 7].map((c) => ws.getRow(1).getCell(c).value);
    expect(headers).toEqual([
      'Position',
      'Ticker',
      'Cost Basis ($)',
      'Current Value ($)',
      'Unrealized Loss ($)',
      'Unrealized Loss (%)',
      'Wash-Sale Status',
    ]);
  });
});

describe('buildTaxHarvestPlanWorkbook — position rows', () => {
  it('writes one row per position with values rounded to 2dp', async () => {
    const wb = await buildWorkbook(INPUT);
    const ws = wb.getWorksheet('Harvest Candidates')!;
    const row = ws.getRow(2);
    expect([
      row.getCell(1).value,
      row.getCell(2).value,
      row.getCell(3).value,
      row.getCell(4).value,
      row.getCell(5).value,
      row.getCell(6).value,
      row.getCell(7).value,
    ]).toEqual(['Intel Corporation', 'INTC', 5000.55, 3765.44, -1234.57, -24.69, 'Clear']);
  });

  it('derives wash-sale risk text from the safe flag + days', async () => {
    const wb = await buildWorkbook(INPUT);
    const ws = wb.getWorksheet('Harvest Candidates')!;
    expect(ws.getRow(3).getCell(2).value).toBe('CHWY');
    expect(ws.getRow(3).getCell(7).value).toBe('Wash-sale risk — bought 12 days ago');
  });

  it('formats currency/percent cells and adds a styled totals row', async () => {
    const wb = await buildWorkbook(INPUT);
    const ws = wb.getWorksheet('Harvest Candidates')!;
    const row2 = ws.getRow(2);
    expect(row2.getCell(3).numFmt).toBe(CURRENCY_FMT);
    expect(row2.getCell(4).numFmt).toBe(CURRENCY_FMT);
    expect(row2.getCell(5).numFmt).toBe(CURRENCY_FMT);

    const totals = ws.getRow(4);
    expect(totals.getCell(1).value).toBe('TOTAL');
    expect(totals.font?.bold).toBe(true);
    expect(totals.getCell(5).value).toBe(num(-1734.567));
    expect(totals.getCell(5).fill).toMatchObject({ fgColor: { argb: 'FFF1F5F9' } });
  });

  it('still exports an empty plan without throwing', async () => {
    const wb = await buildWorkbook({ ...INPUT, positions: [] });
    const ws = wb.getWorksheet('Harvest Candidates')!;
    expect(ws.rowCount).toBe(2); // header + empty notice
  });
});

describe('buildTaxHarvestPlanWorkbook — header styling (shared with rebalancing)', () => {
  it('reuses the bold white header font on the shared dark fill', async () => {
    const wb = await buildWorkbook(INPUT);
    const headerRow = wb.getWorksheet('Harvest Candidates')!.getRow(1);
    expect(headerRow.font).toMatchObject({
      bold: true,
      size: 11,
      color: { argb: 'FFFFFFFF' },
    });
    expect(headerRow.fill).toMatchObject({ fgColor: { argb: 'FF0B1220' } });
    expect((HEADER_FILL as ExcelJS.FillPattern).fgColor?.argb).toBe('FF0B1220');
    expect(INK).toBe('FF0B1220');
  });
});

describe('buildTaxHarvestPlanWorkbook — Summary sheet', () => {
  it('lists account, access mode and harvest totals', async () => {
    const wb = await buildWorkbook(INPUT);
    const s = wb.getWorksheet('Summary')!;
    expect(s.getCell('A1').value).toBe('Tax Harvest Plan');
    expect(summaryValue(s, 'Account')).toBe('Demo Account');
    expect(summaryValue(s, 'Access')).toBe('Trading enabled');
    expect(summaryValue(s, 'Positions')).toBe(2);
    expect(summaryValue(s, 'Harvestable losses')).toBe(num(1734.567));
    expect(summaryValue(s, 'Estimated tax savings')).toBe(
      num((num(1734.567) ?? 0) * DEFAULT_TAX_RATE),
    );
  });

  it('marks read-only access without gating the export', async () => {
    const wb = await buildWorkbook({ ...INPUT, access: 'read-only' });
    const s = wb.getWorksheet('Summary')!;
    expect(summaryValue(s, 'Access')).toBe('Read-only — orders cannot be placed');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Harvest Candidates']);
  });
});

describe('taxHarvestExportFilename', () => {
  it('embeds the account slug and date', () => {
    expect(taxHarvestExportFilename({ accountName: 'Demo Account', generatedAt: GENERATED_AT })).toBe(
      'vantage-tax-harvest-plan-demo-account-2025-12-03.xlsx',
    );
  });

  it('falls back to the date-only pattern when no account is given', () => {
    expect(taxHarvestExportFilename({ generatedAt: GENERATED_AT })).toBe(
      'vantage-tax-harvest-plan-2025-12-03.xlsx',
    );
  });
});

describe('washSaleStatusText', () => {
  it('prefers an explicit status string', () => {
    expect(washSaleStatusText({ washSaleStatus: 'Blocked', washSaleSafe: true })).toBe('Blocked');
  });
  it('returns Clear for a safe position', () => {
    expect(washSaleStatusText({ washSaleSafe: true })).toBe('Clear');
  });
  it('describes a wash-sale risk with the day count', () => {
    expect(washSaleStatusText({ washSaleSafe: false, daysSinceLastTrade: 3 })).toBe(
      'Wash-sale risk — bought 3 days ago',
    );
  });
});
