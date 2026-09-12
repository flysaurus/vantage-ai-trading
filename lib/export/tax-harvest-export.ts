import ExcelJS from 'exceljs';
import {
  CURRENCY_FMT,
  PERCENT_FMT,
  INK,
  MUTED,
  HEADER_FILL,
  num,
  styleHeaderRow,
} from './rebalance-plan-export';

/**
 * Excel (.xlsx) export for the Tax Loss Harvesting plan
 * (`app/strategies/setup/tax-harvesting/page.tsx`).
 *
 * Mirrors the Portfolio Rebalancing export (`lib/export/rebalance-plan-export.ts`)
 * tabular layout + styling EXACTLY — same INK/HEADER_FILL/CURRENCY_FMT tokens,
 * same `num()` rounding, same `styleHeaderRow()`, same frozen header views and
 * same title/section treatment — so the two exports feel like one product.
 *
 * Sheets:
 *   1. Summary            — account, broker, environment, access mode, timestamp,
 *                           harvest totals (harvestable losses, est. tax savings,
 *                           position count)
 *   2. Harvest Candidates — one row per harvester position + styled totals row
 *
 * The API route (`app/api/strategies/tax-harvest/export/route.ts`) owns transport
 * (auth + attachment headers); this module owns layout. Applies to read-only AND
 * trading accounts — the download is never gated on trading capability.
 *
 * Out of scope (intentionally absent): replacement / reinvestment / substitute
 * security content of any kind.
 */

/** One harvester (a position carrying an unrealized loss). */
export interface TaxHarvestExportPosition {
  /** Ticker symbol, e.g. "INTC". */
  symbol: string;
  /** Company / security name shown in the "Position" column. */
  name?: string | null;
  qty?: number | null;
  /** Total cost basis in dollars (positive). */
  costBasis: number;
  /** Current market value in dollars (positive). */
  marketValue: number;
  /** Unrealized loss in dollars — negative for a losing position. */
  unrealizedLoss: number;
  /** Unrealized loss as a percent — negative for a losing position. */
  unrealizedLossPct: number;
  /**
   * Wash-sale status *text*. When omitted it is derived from `washSaleSafe` /
   * `daysSinceLastTrade` (see `washSaleStatusText`). e.g. "Clear" or
   * "Wash-sale risk — bought 12 days ago".
   */
  washSaleStatus?: string | null;
  /** Convenience flag: false ⇒ a recent buy blocks the harvest. */
  washSaleSafe?: boolean | null;
  /** Days since the most recent purchase (for the derived status text). */
  daysSinceLastTrade?: number | null;
}

export interface TaxHarvestPlanExportInput {
  /** Display name of the account the plan targets. */
  accountName: string;
  broker?: string | null;
  environment?: 'demo' | 'paper' | 'live' | null;
  /** 'read-only' connections can review/download but not execute. */
  access: 'read-only' | 'trading';
  isDemo?: boolean;
  /** Tax year the plan applies to (defaults to the generated year). */
  taxYear?: number | null;
  /** Blended capital-gains rate used for the savings estimate (default 0.20). */
  estimatedTaxRate?: number | null;
  positions: TaxHarvestExportPosition[];
  generatedAt?: Date;
  note?: string | null;
}

/** Illustrative blended short-term capital-gains rate for the savings estimate. */
export const DEFAULT_TAX_RATE = 0.2;

/**
 * Wash-sale status text for a position.
 * Prefers an explicit `washSaleStatus`; otherwise derives from the safe flag.
 */
export function washSaleStatusText(p: {
  washSaleStatus?: string | null;
  washSaleSafe?: boolean | null;
  daysSinceLastTrade?: number | null;
}): string {
  const explicit = p.washSaleStatus != null ? String(p.washSaleStatus).trim() : '';
  if (explicit) return explicit;
  if (p.washSaleSafe === false) {
    const d = p.daysSinceLastTrade;
    return Number.isFinite(d as number)
      ? `Wash-sale risk — bought ${d} days ago`
      : 'Wash-sale risk';
  }
  return 'Clear';
}

/** Safe ASCII filename stem for the plan (mirrors the rebalancing helper). */
export function taxHarvestExportFilename(input: {
  accountName?: string | null;
  generatedAt?: Date;
}): string {
  const d = input.generatedAt ?? new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  const slug =
    input.accountName != null
      ? input.accountName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40)
      : '';
  return slug
    ? `vantage-tax-harvest-plan-${slug}-${stamp}.xlsx`
    : `vantage-tax-harvest-plan-${stamp}.xlsx`;
}

function safePositions(rows: TaxHarvestExportPosition[]): TaxHarvestExportPosition[] {
  return rows
    .filter((r) => r && r.symbol)
    .map((r) => ({
      ...r,
      symbol: String(r.symbol).toUpperCase(),
      costBasis: Number.isFinite(r.costBasis) ? r.costBasis : 0,
      marketValue: Number.isFinite(r.marketValue) ? r.marketValue : 0,
      unrealizedLoss: Number.isFinite(r.unrealizedLoss) ? r.unrealizedLoss : 0,
      unrealizedLossPct: Number.isFinite(r.unrealizedLossPct) ? r.unrealizedLossPct : 0,
    }));
}

/**
 * Build the tax-loss-harvesting plan workbook as a Node Buffer (.xlsx).
 * Never throws on partial data — a plan with zero positions still exports.
 */
export async function buildTaxHarvestPlanWorkbook(
  input: TaxHarvestPlanExportInput,
): Promise<Buffer> {
  const generatedAt = input.generatedAt ?? new Date();
  const taxYear = input.taxYear ?? generatedAt.getFullYear();
  const taxRate =
    input.estimatedTaxRate != null && Number.isFinite(input.estimatedTaxRate)
      ? input.estimatedTaxRate
      : DEFAULT_TAX_RATE;

  const positions = safePositions(input.positions);
  const harvestableLosses =
    num(positions.reduce((s, p) => s + (p.unrealizedLoss < 0 ? Math.abs(p.unrealizedLoss) : 0), 0)) ??
    0;
  const estimatedTaxSavings = num(harvestableLosses * taxRate) ?? 0;
  const totalCostBasis = num(positions.reduce((s, p) => s + p.costBasis, 0)) ?? 0;
  const totalCurrentValue = num(positions.reduce((s, p) => s + p.marketValue, 0)) ?? 0;
  const totalLoss = num(positions.reduce((s, p) => s + p.unrealizedLoss, 0)) ?? 0;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vantage';
  wb.created = generatedAt;

  // ── Sheet 1: Summary ─────────────────────────────────────────────────────
  const s = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  s.columns = [{ width: 30 }, { width: 46 }, { width: 22 }];

  const title = s.getCell('A1');
  title.value = 'Tax Harvest Plan';
  title.font = { bold: true, size: 18, color: { argb: INK } };
  s.mergeCells('A1:C1');
  s.getRow(1).height = 24;

  const sub = s.getCell('A2');
  sub.value = `${input.accountName} · Tax year ${taxYear}`;
  sub.font = { size: 12, italic: true, color: { argb: MUTED } };
  s.mergeCells('A2:C2');

  let r = 4;
  const kv = (
    label: string,
    value: string | number | null,
    opts?: { fmt?: string; bold?: boolean },
  ) => {
    const c1 = s.getCell(`A${r}`);
    c1.value = label;
    c1.font = { bold: true, size: 11, color: { argb: INK } };
    const c2 = s.getCell(`B${r}`);
    c2.value = value ?? '—';
    c2.font = { size: 11, color: { argb: 'FF334155' }, bold: opts?.bold ?? false };
    if (opts?.fmt) c2.numFmt = opts.fmt;
    r += 1;
  };

  const sectionHeader = (label: string) => {
    const c = s.getCell(`A${r}`);
    c.value = label;
    c.font = { bold: true, size: 11, color: { argb: 'FF0A6B75' } };
    s.mergeCells(`A${r}:C${r}`);
    const row = s.getRow(r);
    row.height = 18;
    r += 1;
  };

  sectionHeader('ACCOUNT');
  kv('Account', input.accountName);
  kv('Brokerage', input.broker || (input.isDemo ? 'Demo (simulated)' : '—'));
  kv(
    'Environment',
    input.environment ? input.environment.toUpperCase() : input.isDemo ? 'DEMO' : '—',
  );
  kv(
    'Access',
    input.access === 'read-only'
      ? 'Read-only — orders cannot be placed'
      : 'Trading enabled',
  );
  r += 1;

  sectionHeader('PLAN');
  kv('Tax year', taxYear);
  kv(
    'Plan date',
    generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  );
  kv('Generated (local)', generatedAt.toLocaleString('en-US'));
  kv('Generated (UTC)', generatedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
  r += 1;

  sectionHeader('HARVEST');
  kv('Positions', positions.length, { bold: true });
  kv('Harvestable losses', harvestableLosses, { fmt: CURRENCY_FMT, bold: true });
  kv('Estimated tax savings', estimatedTaxSavings, { fmt: CURRENCY_FMT, bold: true });
  kv('Assumed tax rate', num(taxRate * 100), { fmt: PERCENT_FMT });
  r += 1;

  if (input.note || input.access === 'read-only') {
    const note = s.getCell(`A${r}`);
    note.value =
      input.note ||
      'Read-only account — harvested positions cannot be sold from Vantage. Review or share this plan, then execute it on a trading-enabled account.';
    note.font = { size: 10, italic: true, color: { argb: MUTED } };
    note.alignment = { wrapText: true, vertical: 'top' };
    s.mergeCells(`A${r}:C${r}`);
    s.getRow(r).height = 30;
    r += 1;
  }

  const foot = s.getCell(`A${r + 1}`);
  foot.value =
    'Generated by Vantage. Losses are unrealized as of this plan and may move before execution. Not tax advice.';
  foot.font = { size: 9, color: { argb: 'FF94A3B8' } };
  s.mergeCells(`A${r + 1}:C${r + 1}`);

  // ── Sheet 2: Harvest Candidates ──────────────────────────────────────────
  const ws = wb.addWorksheet('Harvest Candidates', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Position', key: 'position', width: 30 },
    { header: 'Ticker', key: 'symbol', width: 12 },
    { header: 'Cost Basis ($)', key: 'costBasis', width: 16 },
    { header: 'Current Value ($)', key: 'currentValue', width: 18 },
    { header: 'Unrealized Loss ($)', key: 'loss', width: 18 },
    { header: 'Unrealized Loss (%)', key: 'lossPct', width: 18 },
    { header: 'Wash-Sale Status', key: 'wash', width: 30 },
  ];
  styleHeaderRow(ws.getRow(1));
  ws.autoFilter = { from: 'A1', to: 'G1' };

  if (positions.length === 0) {
    const empty = ws.addRow([
      'No harvestable losses',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    empty.getCell(1).font = { italic: true, color: { argb: MUTED } };
  } else {
    for (const p of positions) {
      const added = ws.addRow([
        p.name || p.symbol,
        p.symbol,
        num(p.costBasis),
        num(p.marketValue),
        num(p.unrealizedLoss),
        num(p.unrealizedLossPct),
        washSaleStatusText(p),
      ]);
      added.getCell(3).numFmt = CURRENCY_FMT;
      added.getCell(4).numFmt = CURRENCY_FMT;
      added.getCell(5).numFmt = CURRENCY_FMT;
      added.getCell(6).numFmt = PERCENT_FMT;
      added.getCell(5).font = { color: { argb: 'FFB91C1C' } };
      if (p.washSaleSafe === false) {
        added.getCell(7).font = { color: { argb: 'FFB45309' }, bold: true };
      }
    }

    // Totals row — styled like the rebalancing totals/subtotal rows.
    const totals = ws.addRow([
      'TOTAL',
      null,
      totalCostBasis,
      totalCurrentValue,
      totalLoss,
      null,
      null,
    ]);
    totals.font = { bold: true };
    totals.getCell(3).numFmt = CURRENCY_FMT;
    totals.getCell(4).numFmt = CURRENCY_FMT;
    totals.getCell(5).numFmt = CURRENCY_FMT;
    totals.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// Re-export the shared header-fill token so consumers can style consistently.
export { HEADER_FILL };
