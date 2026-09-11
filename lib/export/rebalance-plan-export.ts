import ExcelJS from 'exceljs';

/**
 * Excel (.xlsx) export for the Portfolio Rebalancing plan
 * (`app/strategies/setup/rebalancing/page.tsx`).
 *
 * Distinct from the AI-Advisor export in `lib/export/xlsx.ts`: a rebalance plan
 * is a *comparison* document (current vs target allocation) PLUS the exact
 * order list that will be placed, so it gets its own multi-sheet layout:
 *
 *   1. Summary      — account name, broker, plan date/time, totals, access mode
 *   2. Allocation   — OLD (current) vs NEW (target) per symbol
 *   3. Buy Orders   — exact buy legs
 *   4. Sell Orders  — exact sell legs
 *
 * Consumed by `app/api/strategies/rebalancing/export/route.ts`. The API route
 * owns transport (auth + attachment headers); this module owns layout.
 */

export interface RebalanceExportPosition {
  symbol: string;
  name?: string | null;
  qty: number;
  price: number;
  marketValue: number;
}

export interface RebalanceExportOrder {
  symbol: string;
  name?: string | null;
  action: 'BUY' | 'SELL';
  shares: number;
  price: number;
  estimatedValue: number;
  /** 'market' | 'limit' | 'stop' (queue orders carry this; simple plans are market). */
  orderType?: string | null;
  limitPrice?: number | null;
}

export interface RebalancePlanExportInput {
  /** Display name of the account the plan targets. */
  accountName: string;
  broker?: string | null;
  environment?: 'demo' | 'paper' | 'live' | null;
  /** 'read-only' connections can review/download but not execute. */
  access: 'read-only' | 'trading';
  isDemo: boolean;
  /** Investor style / strategy label, e.g. "Buffett (Value)". */
  styleName: string;
  totalValue: number;
  cash?: number | null;
  buyingPower?: number | null;
  driftThreshold?: number | null;
  driftAlertEnabled?: boolean;
  positions: RebalanceExportPosition[];
  /** symbol → target percent (0-100). */
  targets: Record<string, number>;
  orders: RebalanceExportOrder[];
  generatedAt?: Date;
  note?: string | null;
}

const CURRENCY_FMT = '"$"#,##0.00';
const PERCENT_FMT = '0.00"%"';
const QTY_FMT = '#,##0.0000';
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0B1220' },
};
const INK = 'FF0B1220';
const MUTED = 'FF64748B';

function num(value: number | null | undefined, dp = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}

function safe(rows: RebalanceExportOrder[]): RebalanceExportOrder[] {
  return rows
    .filter((r) => r && r.symbol)
    .map((r) => ({
      ...r,
      symbol: String(r.symbol).toUpperCase(),
      shares: Number.isFinite(r.shares) ? r.shares : 0,
      price: Number.isFinite(r.price) ? r.price : 0,
      estimatedValue: Number.isFinite(r.estimatedValue) ? r.estimatedValue : 0,
    }));
}

/** Safe ASCII filename stem for the plan (account + date). */
export function rebalanceExportFilename(input: {
  accountName: string;
  generatedAt?: Date;
}): string {
  const slug = input.accountName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'account';
  const d = input.generatedAt ?? new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
  return `vantage-rebalance-plan-${slug}-${stamp}.xlsx`;
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

/**
 * Build the rebalance-plan workbook as a Node Buffer (.xlsx).
 * Never throws on partial data — a plan with zero orders still exports
 * (read-only users want the allocation comparison too).
 */
export async function buildRebalancePlanWorkbook(
  input: RebalancePlanExportInput,
): Promise<Buffer> {
  const generatedAt = input.generatedAt ?? new Date();
  const orders = safe(input.orders);
  const buys = orders.filter((o) => o.action === 'BUY');
  const sells = orders.filter((o) => o.action === 'SELL');
  const totalBuys = num(buys.reduce((s, o) => s + o.estimatedValue, 0)) ?? 0;
  const totalSells = num(sells.reduce((s, o) => s + o.estimatedValue, 0)) ?? 0;
  const netCash = num(totalSells - totalBuys) ?? 0;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vantage';
  wb.created = generatedAt;

  // ── Sheet 1: Summary ─────────────────────────────────────────────────────
  const s = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  s.columns = [{ width: 30 }, { width: 46 }, { width: 22 }];

  const title = s.getCell('A1');
  title.value = 'Rebalance Plan';
  title.font = { bold: true, size: 18, color: { argb: INK } };
  s.mergeCells('A1:C1');
  s.getRow(1).height = 24;

  const sub = s.getCell('A2');
  sub.value = `${input.accountName} · ${input.styleName}`;
  sub.font = { size: 12, italic: true, color: { argb: MUTED } };
  s.mergeCells('A2:C2');

  let r = 4;
  const kv = (label: string, value: string | number | null, opts?: { fmt?: string; bold?: boolean }) => {
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
  kv('Access', input.access === 'read-only' ? 'Read-only — orders cannot be placed' : 'Trading enabled');
  r += 1;

  sectionHeader('PLAN');
  kv('Strategy / style', input.styleName);
  kv('Plan date', generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  kv('Generated (local)', generatedAt.toLocaleString('en-US'));
  kv('Generated (UTC)', generatedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
  if (input.driftThreshold != null) {
    kv(
      'Drift alert',
      input.driftAlertEnabled === false
        ? `Off (threshold ${input.driftThreshold}%)`
        : `On — alert when drift exceeds ${input.driftThreshold}%`,
    );
  }
  r += 1;

  sectionHeader('PORTFOLIO');
  kv('Portfolio value', num(input.totalValue), { fmt: CURRENCY_FMT, bold: true });
  if (input.cash != null) kv('Settled cash', num(input.cash), { fmt: CURRENCY_FMT });
  if (input.buyingPower != null) kv('Buying power', num(input.buyingPower), { fmt: CURRENCY_FMT });
  kv('Positions', input.positions.length);
  const targetTotal = num(Object.values(input.targets).reduce((a, b) => a + (Number(b) || 0), 0)) ?? 0;
  kv('Target allocation total', targetTotal, { fmt: PERCENT_FMT });
  r += 1;

  sectionHeader('ORDERS');
  kv('Total orders', orders.length, { bold: true });
  kv('Buys', `${buys.length} orders · $${totalBuys.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  kv('Sells', `${sells.length} orders · $${totalSells.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  kv('Net cash impact', netCash, { fmt: CURRENCY_FMT, bold: true });
  r += 1;

  if (input.note || input.access === 'read-only') {
    const note = s.getCell(`A${r}`);
    note.value =
      input.note ||
      'Read-only account — rebalancing orders cannot be placed from Vantage. Review or share this plan, then execute it on a trading-enabled account.';
    note.font = { size: 10, italic: true, color: { argb: MUTED } };
    note.alignment = { wrapText: true, vertical: 'top' };
    s.mergeCells(`A${r}:C${r}`);
    s.getRow(r).height = 30;
    r += 1;
  }

  const foot = s.getCell(`A${r + 1}`);
  foot.value = 'Generated by Vantage. Prices are the values used when this plan was calculated and may move before execution.';
  foot.font = { size: 9, color: { argb: 'FF94A3B8' } };
  s.mergeCells(`A${r + 1}:C${r + 1}`);

  // ── Sheet 2: Allocation (old vs new) ─────────────────────────────────────
  const alloc = wb.addWorksheet('Allocation', { views: [{ state: 'frozen', ySplit: 1 }] });
  alloc.columns = [
    { header: 'Symbol', key: 'symbol', width: 12 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Current Value ($)', key: 'currentValue', width: 18 },
    { header: 'Current %', key: 'currentPct', width: 12 },
    { header: 'Target %', key: 'targetPct', width: 12 },
    { header: 'New Value ($)', key: 'newValue', width: 16 },
    { header: 'Change ($)', key: 'change', width: 14 },
    { header: 'Change %', key: 'changePct', width: 12 },
    { header: 'Action', key: 'action', width: 12 },
  ];
  styleHeaderRow(alloc.getRow(1));
  alloc.autoFilter = { from: 'A1', to: 'I1' };

  const actionBySymbol = new Map<string, string>();
  for (const o of orders) actionBySymbol.set(o.symbol, o.action === 'BUY' ? 'BUY' : 'SELL');

  const symbols = new Set<string>([
    ...input.positions.map((p) => String(p.symbol).toUpperCase()),
    ...Object.keys(input.targets).map((k) => k.toUpperCase()),
  ]);

  const posBySymbol = new Map(input.positions.map((p) => [String(p.symbol).toUpperCase(), p]));
  const totalValue = input.totalValue > 0 ? input.totalValue : 0;

  const allocRows = Array.from(symbols).map((sym) => {
    const pos = posBySymbol.get(sym);
    const currentValue = num(pos?.marketValue ?? 0) ?? 0;
    const currentPct = totalValue > 0 ? num((currentValue / totalValue) * 100) ?? 0 : 0;
    const targetPct = num(input.targets[sym] ?? 0) ?? 0;
    const newValue = totalValue > 0 ? num((targetPct / 100) * totalValue) ?? 0 : 0;
    const change = num(newValue - currentValue) ?? 0;
    const changePct = num(targetPct - currentPct) ?? 0;
    return {
      symbol: sym,
      name: pos?.name ?? null,
      currentValue,
      currentPct,
      targetPct,
      newValue,
      change,
      changePct,
      action: actionBySymbol.get(sym) ?? (Math.abs(change) < 0.01 ? 'No change' : '—'),
    };
  });
  allocRows.sort((a, b) => b.currentValue - a.currentValue || a.symbol.localeCompare(b.symbol));

  for (const row of allocRows) {
    const added = alloc.addRow([
      row.symbol,
      row.name,
      num(row.currentValue),
      num(row.currentPct),
      num(row.targetPct),
      num(row.newValue),
      num(row.change),
      num(row.changePct),
      row.action,
    ]);
    added.getCell(3).numFmt = CURRENCY_FMT;
    added.getCell(4).numFmt = PERCENT_FMT;
    added.getCell(5).numFmt = PERCENT_FMT;
    added.getCell(6).numFmt = CURRENCY_FMT;
    added.getCell(7).numFmt = CURRENCY_FMT;
    added.getCell(8).numFmt = PERCENT_FMT;
    const actionCell = added.getCell(9);
    if (row.action === 'BUY') actionCell.font = { color: { argb: 'FF15803D' }, bold: true };
    else if (row.action === 'SELL') actionCell.font = { color: { argb: 'FFB91C1C' }, bold: true };
  }

  // Totals row
  const allocTotal = alloc.addRow([
    'TOTAL',
    null,
    num(allocRows.reduce((a, b) => a + b.currentValue, 0)),
    num(allocRows.reduce((a, b) => a + b.currentPct, 0)),
    num(allocRows.reduce((a, b) => a + b.targetPct, 0)),
    num(allocRows.reduce((a, b) => a + b.newValue, 0)),
    null,
    null,
    null,
  ]);
  allocTotal.font = { bold: true };
  for (const i of [3, 4, 5, 6]) allocTotal.getCell(i).numFmt = i === 3 || i === 6 ? CURRENCY_FMT : PERCENT_FMT;

  // ── Sheets 3 & 4: exact order lists ──────────────────────────────────────
  const orderSheet = (name: string, rows: RebalanceExportOrder[], accent: string) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '#', key: 'n', width: 6 },
      { header: 'Symbol', key: 'symbol', width: 12 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Action', key: 'action', width: 10 },
      { header: 'Shares', key: 'shares', width: 14 },
      { header: 'Price ($)', key: 'price', width: 13 },
      { header: 'Est. Value ($)', key: 'value', width: 16 },
      { header: 'Order Type', key: 'type', width: 13 },
      { header: 'Limit Price ($)', key: 'limit', width: 15 },
    ];
    styleHeaderRow(ws.getRow(1));
    ws.autoFilter = { from: 'A1', to: 'I1' };

    const knownName = new Map(input.positions.map((p) => [String(p.symbol).toUpperCase(), p.name ?? null]));
    rows.forEach((o, i) => {
      const added = ws.addRow([
        i + 1,
        o.symbol,
        o.name ?? knownName.get(o.symbol) ?? null,
        o.action,
        num(o.shares, 4),
        num(o.price),
        num(o.estimatedValue),
        o.orderType ? o.orderType.charAt(0).toUpperCase() + o.orderType.slice(1) : 'Market',
        o.limitPrice != null ? num(o.limitPrice) : null,
      ]);
      added.getCell(4).font = { color: { argb: accent }, bold: true };
      added.getCell(5).numFmt = QTY_FMT;
      added.getCell(6).numFmt = CURRENCY_FMT;
      added.getCell(7).numFmt = CURRENCY_FMT;
      added.getCell(9).numFmt = CURRENCY_FMT;
    });

    if (rows.length === 0) {
      const empty = ws.addRow([null, null, `No ${name.toLowerCase()} in this plan`, null, null, null, null, null, null]);
      empty.getCell(3).font = { italic: true, color: { argb: MUTED } };
      return;
    }

    const subtotal = ws.addRow([
      null, null, null, null, null, 'Subtotal', num(rows.reduce((a, b) => a + b.estimatedValue, 0)), null, null,
    ]);
    subtotal.font = { bold: true };
    subtotal.getCell(6).alignment = { horizontal: 'right' };
    subtotal.getCell(7).numFmt = CURRENCY_FMT;
    subtotal.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  };

  orderSheet('Buy Orders', buys, 'FF15803D');
  orderSheet('Sell Orders', sells, 'FFB91C1C');

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
