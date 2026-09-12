// ═══════════════════════════════════════════════════════════════
// tests/tax-harvest-illustrative.test.ts
//
// REGRESSION LOCK — "never report $0.00 / 0.00% over a data gap".
//
// A downloaded Tax Harvest Plan once showed:
//     Assumed tax rate: 0.00%
//     Estimated tax savings: $0.00
// because every position lacked a purchase date and undated losses were
// *excluded* from the estimate. $0.00 reads as "no tax benefit exists", which
// is a lie about a portfolio full of real losses.
//
// Contract now:
//   • undated losses are still held out of the PRECISE figure, and
//   • they carry a clearly-labelled ILLUSTRATIVE range, and
//   • the headline savings is never a bare $0.00 while harvestable losses
//     exist, and never a 0.00% assumed rate.
//
// Run: npx vitest run tests/tax-harvest-illustrative.test.ts
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildTaxHarvestPlanWorkbook,
  type TaxHarvestPlanExportInput,
} from '@/lib/export/tax-harvest-export';
import {
  computePositionHoldingPeriod,
  illustrativeEstimate,
  illustrativeNote,
  headlineSavings,
  summarizeTaxEstimate,
  ILLUSTRATIVE_LOW_RATE,
  ILLUSTRATIVE_HIGH_RATE,
} from '@/lib/tax-harvest/holding-period';
import { num } from '@/lib/export/rebalance-plan-export';

const GENERATED_AT = new Date('2026-09-12T20:04:05.000Z');

/** One losing position, NO purchase date on file (the Fidelity case). */
function undatedLoss(symbol: string, costBasis: number, marketValue: number) {
  return computePositionHoldingPeriod(
    { symbol, qty: 100, avgCost: costBasis / 100, currentPrice: marketValue / 100, marketValue },
    [], // ← no lots
    GENERATED_AT,
  );
}

async function buildWorkbook(input: TaxHarvestPlanExportInput): Promise<ExcelJS.Workbook> {
  const buffer = await buildTaxHarvestPlanWorkbook(input);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

function summaryValue(ws: ExcelJS.Worksheet, label: string): ExcelJS.CellValue {
  let found: ExcelJS.CellValue = null;
  ws.eachRow((row) => {
    if (String(row.getCell(1).value ?? '').trim() === label) found = row.getCell(2).value;
  });
  return found;
}

function summaryLabels(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.eachRow((row) => {
    const v = String(row.getCell(1).value ?? '').trim();
    if (v) out.push(v);
  });
  return out;
}

describe('illustrativeEstimate — undated losses keep a labelled range', () => {
  const breakdowns = [
    undatedLoss('NVDA', 10000, 7000), // $3,000 loss, no date
    undatedLoss('QQQ', 5000, 4500), //  $500 loss, no date
  ];

  it('sums every undated loss instead of dropping it', () => {
    const est = illustrativeEstimate(breakdowns)!;
    expect(est).not.toBeNull();
    expect(est.loss).toBeCloseTo(3500, 6);
    expect(est.positionCount).toBe(2);
    expect(est.symbols).toEqual(['NVDA', 'QQQ']);
  });

  it('brackets the losses with the long-term low and short-term high', () => {
    const est = illustrativeEstimate(breakdowns)!;
    expect(est.low).toBeCloseTo(3500 * ILLUSTRATIVE_LOW_RATE, 6);
    expect(est.high).toBeCloseTo(3500 * ILLUSTRATIVE_HIGH_RATE, 6);
    expect(est.high).toBeGreaterThan(est.low);
    expect(est.low).toBeGreaterThan(0);
  });

  it('returns null when nothing is undated (no phantom range on a clean book)', () => {
    expect(illustrativeEstimate([])).toBeNull();
    expect(illustrativeEstimate(null)).toBeNull();
    // a fully-dated position contributes no unknown loss
    const dated = computePositionHoldingPeriod(
      { symbol: 'AAPL', qty: 10, avgCost: 100, currentPrice: 90, marketValue: 900 },
      [{ id: 'l1', qty: 10, remainingQty: 10, priceAtFill: 100, filledAt: '2026-08-01T14:30:00.000Z' }],
      GENERATED_AT,
    );
    expect(illustrativeEstimate([dated])).toBeNull();
  });

  it('the note names the count, the dollars and the band — and never claims precision', () => {
    const note = illustrativeNote(illustrativeEstimate(breakdowns));
    expect(note).toContain('2 positions');
    expect(note).toContain('$3500.00');
    expect(note).toContain('no purchase date on file');
    expect(note).toContain(`${Math.round(ILLUSTRATIVE_LOW_RATE * 100)}%`);
    expect(note).toContain('not per-position accuracy');
    expect(illustrativeNote(null)).toBe('');
  });
});

describe('headlineSavings — a data gap is never rendered as $0.00', () => {
  it('returns null (not 0) when nothing could be classified', () => {
    const summary = summarizeTaxEstimate([undatedLoss('NVDA', 10000, 7000)]);
    expect(summary.estimatedSavings).toBe(0);
    expect(summary.unknownLoss).toBeCloseTo(3000, 6);
    expect(headlineSavings(summary)).toBeNull();
  });

  it('returns the precise figure when there is one', () => {
    const dated = computePositionHoldingPeriod(
      { symbol: 'AAPL', qty: 10, avgCost: 100, currentPrice: 80, marketValue: 800 },
      [{ id: 'l1', qty: 10, remainingQty: 10, priceAtFill: 100, filledAt: '2026-08-01T14:30:00.000Z' }],
      GENERATED_AT,
    );
    const summary = summarizeTaxEstimate([dated]);
    expect(summary.estimatedSavings).toBeGreaterThan(0);
    expect(headlineSavings(summary)).toBeCloseTo(summary.estimatedSavings, 6);
  });
});

describe('buildTaxHarvestPlanWorkbook — the exported plan never says 0.00%', () => {
  /** The exact regression report: 9 Fidelity losses, all undated. */
  const undatedPlan: TaxHarvestPlanExportInput = {
    accountName: 'Fidelity Brokerage',
    broker: 'Fidelity',
    environment: 'live',
    access: 'read-only',
    taxYear: 2026,
    positions: [
      {
        symbol: 'NVDA',
        name: 'NVIDIA Corp',
        qty: 10,
        costBasis: 10000,
        marketValue: 7000,
        unrealizedLoss: -3000,
        unrealizedLossPct: -30,
        washSaleSafe: true,
      },
    ],
    preciseSavings: 0, // nothing could be dated
    illustrative: {
      loss: 3000,
      low: 3000 * ILLUSTRATIVE_LOW_RATE,
      high: 3000 * ILLUSTRATIVE_HIGH_RATE,
      positionCount: 1,
      note: 'illustrative',
    },
    generatedAt: GENERATED_AT,
  };

  it('labels the precise figure and adds a separate illustrative range', async () => {
    const wb = await buildWorkbook(undatedPlan);
    const s = wb.getWorksheet('Summary')!;
    expect(summaryValue(s, 'Estimated tax savings (dated positions)')).toBe(0);
    expect(summaryValue(s, 'No purchase date on file (illustrative)')).toBe(num(3000));
    expect(summaryValue(s, 'Illustrative savings on those 1 position')).toBe(
      `$450.00 – $720.00`,
    );
    expect(summaryValue(s, 'Total savings range')).toBe(`$450.00 – $720.00`);
  });

  it('reports a blended assumed rate that is NEVER 0.00%', async () => {
    const wb = await buildWorkbook(undatedPlan);
    const s = wb.getWorksheet('Summary')!;
    const rate = summaryValue(s, 'Assumed tax rate');
    expect(rate).not.toBe(null);
    // 3000 × mid(15%,24%) / 3000 losses = 19.5%
    expect(rate).toBeCloseTo(19.5, 6);
    expect(rate as number).toBeGreaterThan(0);
    expect(summaryValue(s, 'Basis')).toContain('no purchase date on file');
    expect(summaryValue(s, 'Illustrative band')).toBe('15% – 24%');
  });

  it('does not print a bare "Estimated tax savings" row when the figure is undated', async () => {
    const wb = await buildWorkbook(undatedPlan);
    expect(summaryLabels(wb.getWorksheet('Summary')!)).not.toContain('Estimated tax savings');
  });

  it('keeps the old single-figure behavior for a fully-dated plan', async () => {
    const wb = await buildWorkbook({
      accountName: 'Demo Account',
      access: 'trading',
      taxYear: 2026,
      estimatedTaxRate: 0.2,
      positions: [
        {
          symbol: 'INTC',
          costBasis: 5000,
          marketValue: 4000,
          unrealizedLoss: -1000,
          unrealizedLossPct: -20,
        },
      ],
      generatedAt: GENERATED_AT,
    });
    const s = wb.getWorksheet('Summary')!;
    expect(summaryValue(s, 'Estimated tax savings')).toBe(num(200));
    expect(summaryValue(s, 'Assumed tax rate')).toBe(20);
    const labels = summaryLabels(s);
    expect(labels).not.toContain('Estimated tax savings (dated positions)');
    expect(labels.some((l) => l.includes('illustrative'))).toBe(false);
  });
});
