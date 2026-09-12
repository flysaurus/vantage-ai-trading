// ─── Tax-harvest export: request-payload normalization ──────────────────────
// Regression lock for the bug that shipped a workbook with the illustrative
// range missing: the API route whitelisted the client payload but dropped
// `preciseSavings` and `illustrative` on the way through, so a plan whose
// positions carry no purchase date silently fell back to the legacy single
// figure (harvestableLosses × rate) — a figure presented as if every position
// had been classified. The normalizer must carry both fields, and the workbook
// built from a normalized payload must show the dated/illustrative split.

import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildTaxHarvestPlanWorkbook,
  normalizeTaxHarvestExportInput,
} from '@/lib/export/tax-harvest-export';

const GENERATED_AT = new Date('2026-09-12T20:04:05.000Z');

/** The exact body the TLH page posts when NO position could be dated. */
const clientBody = {
  accountName: 'ANIKET -YOUTH ACCOUNT',
  broker: 'Fidelity',
  environment: 'live',
  access: 'read-only',
  isDemo: false,
  taxYear: 2026,
  estimatedTaxRate: 0.195,
  preciseSavings: 0,
  illustrative: {
    loss: 379.45,
    low: 56.92,
    high: 91.07,
    positionCount: 9,
    note: '9 positions ($379.45 of losses) have no purchase date on file.',
  },
  positions: [
    { symbol: 'NVDA', name: 'Nvidia', qty: 2, costBasis: 900, marketValue: 600, unrealizedLoss: -300, unrealizedLossPct: -33.3 },
  ],
  note: '9 positions ($379.45 of losses) have no purchase date on file.',
};

async function summaryRows(input: any) {
  const buf = await buildTaxHarvestPlanWorkbook(input);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Summary')!;
  const rows: [string, any][] = [];
  ws.eachRow((r) => {
    const label = r.getCell(1).value;
    const value = r.getCell(2).value;
    const labelText = typeof label === 'string' ? label : label && (label as any).text;
    const valueText = typeof value === 'string' ? value : value && (value as any).text !== undefined ? (value as any).text : value;
    if (labelText != null && String(labelText).trim()) rows.push([String(labelText).trim(), valueText]);
  });
  return rows;
}

describe('normalizeTaxHarvestExportInput', () => {
  it('carries preciseSavings through instead of dropping it', () => {
    const input = normalizeTaxHarvestExportInput(clientBody, GENERATED_AT)!;
    expect(input.preciseSavings).toBe(0);
  });

  it('carries the illustrative block through instead of dropping it', () => {
    const input = normalizeTaxHarvestExportInput(clientBody, GENERATED_AT)!;
    expect(input.illustrative).toEqual({
      loss: 379.45,
      low: 56.92,
      high: 91.07,
      positionCount: 9,
      note: '9 positions ($379.45 of losses) have no purchase date on file.',
    });
  });

  it('keeps a non-zero precise figure when positions could be dated', () => {
    const input = normalizeTaxHarvestExportInput(
      { ...clientBody, preciseSavings: 123.45, illustrative: null },
      GENERATED_AT,
    )!;
    expect(input.preciseSavings).toBe(123.45);
    expect(input.illustrative).toBeNull();
  });

  it('treats an illustrative block with no loss as absent (never a $0.00 range)', () => {
    const input = normalizeTaxHarvestExportInput(
      { ...clientBody, illustrative: { loss: 0, low: 0, high: 0, positionCount: 0 } },
      GENERATED_AT,
    )!;
    expect(input.illustrative).toBeNull();
  });

  it('returns null when there are no usable positions (route 400s on this)', () => {
    expect(normalizeTaxHarvestExportInput({ ...clientBody, positions: [] }, GENERATED_AT)).toBeNull();
    expect(normalizeTaxHarvestExportInput({ ...clientBody, positions: [{ symbol: '' }] }, GENERATED_AT)).toBeNull();
  });

  it('still whitelists: unknown fields and junk numbers never reach the workbook', () => {
    const input = normalizeTaxHarvestExportInput(
      { ...clientBody, evil: 'x', taxYear: 'not-a-year', estimatedTaxRate: NaN, positions: [{ ...clientBody.positions[0], secret: 'y' }] },
      GENERATED_AT,
    )!;
    expect((input as any).evil).toBeUndefined();
    expect((input as any).secret).toBeUndefined();
    expect(input.taxYear).toBeNull();
    expect(input.estimatedTaxRate).toBeNull();
  });
});

describe('workbook built from a normalized client payload', () => {
  it('reports the dated figure and the illustrative range, not one blended number', async () => {
    const input = normalizeTaxHarvestExportInput(clientBody, GENERATED_AT)!;
    const rows = await summaryRows(input);
    const find = (label: string) => rows.find(([l]) => l === label)?.[1];

    expect(find('Estimated tax savings (dated positions)')).toBe(0);
    expect(find('No purchase date on file (illustrative)')).toBe(379.45);
    expect(find('Illustrative savings on those 9 positions')).toBe('$56.92 – $91.07');
    expect(find('Total savings range')).toBe('$56.92 – $91.07');
    expect(find('Illustrative band')).toBe('15% – 24%');
    expect(String(find('Basis'))).toContain('no purchase date on file');
    // The whole point: a blended rate is still reported, so it never reads 0.00%.
    expect(Number(find('Assumed tax rate'))).toBeGreaterThan(0);
    // And the bare legacy row must NOT appear next to the illustrative rows.
    expect(rows.some(([l]) => l === 'Estimated tax savings')).toBe(false);
  });

  it('a fully-dated plan keeps the plain single figure and no illustrative rows', async () => {
    const input = normalizeTaxHarvestExportInput(
      { ...clientBody, preciseSavings: 200, illustrative: null },
      GENERATED_AT,
    )!;
    const rows = await summaryRows(input);
    const find = (label: string) => rows.find(([l]) => l === label)?.[1];

    expect(find('Estimated tax savings')).toBe(200);
    expect(rows.some(([l]) => l.includes('illustrative'))).toBe(false);
    expect(rows.some(([l]) => l.includes('No purchase date on file'))).toBe(false);
  });

  it('never reports an absurd blended rate when the payload is inconsistent', async () => {
    // Undated losses (379.45) far larger than the harvestable loss they sit
    // inside (10) — the ratio would be 739.95%. Fall back to the caller's rate.
    const input = normalizeTaxHarvestExportInput(clientBody, GENERATED_AT)!;
    const rows = await summaryRows(input);
    const rate = Number(rows.find(([l]) => l === 'Assumed tax rate')?.[1]);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(30);
  });
});
