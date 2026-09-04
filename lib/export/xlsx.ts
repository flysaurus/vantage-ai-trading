import ExcelJS from 'exceljs';

/**
 * Downloadable-export (Excel .xlsx) generation for AI Advisor structured
 * responses. This is the SINGLE shared implementation consumed by:
 *   1. the chat AI Advisor Download button (rebalance plans, portfolio builds,
 *      basket previews, position/analysis responses), and
 *   2. the read-only-account rebalance/DCA "download the plan" path.
 *
 * The payload is deliberately presentation-agnostic: callers pass structured
 * rows + an optional thesis, and this module owns the workbook layout/formatting.
 */

export type ExportAction = 'buy' | 'sell' | 'hold';

export interface ExportRow {
  /** Uppercased US ticker (e.g. "AAPL"). */
  ticker: string;
  /** Human-readable holding/company name (e.g. "Apple Inc.", "Small-Cap"). */
  company?: string | null;
  action: ExportAction;
  /** Share count when known (sell legs / existing positions). */
  qty?: number | null;
  /** Dollar amount (buy legs / dollar-based recommendations). */
  amountUsd?: number | null;
  /** Price at generation time, when known. */
  price?: number | null;
  /** Line total (≈ amountUsd, or qty × price). */
  lineTotal?: number | null;
  /** Per-row rationale/thesis, when available. */
  note?: string | null;
}

export interface ExportPayload {
  /** Workbook title, e.g. "Rebalance Plan — Buffett (Value)". */
  title: string;
  /** Optional subtitle line (e.g. "Cash-only deployment — no sells"). */
  subtitle?: string | null;
  /** Overall AI thesis/rationale commentary (rendered in the Summary sheet). */
  thesis?: string | null;
  /** Optional grand-total figure; defaults to the sum of row line totals. */
  grandTotal?: number | null;
  rows: ExportRow[];
}

const ACTION_LABEL: Record<ExportAction, string> = {
  buy: 'Buy',
  sell: 'Sell',
  hold: 'Hold',
};

/** Sanitize a title into a safe, ASCII filename stem. */
export function exportFilenameStem(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'vantage-export';
}

function currencyCell(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Build an .xlsx workbook (as a Node Buffer) from an export payload.
 * Two sheets: "Summary" (title/subtitle/thesis) and "Allocation" (the table).
 */
export async function buildExportWorkbook(payload: ExportPayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vantage';
  wb.created = new Date();

  // ── Summary sheet ────────────────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 24 }, { width: 40 }, { width: 24 }];

  const titleCell = summary.getCell('A1');
  titleCell.value = payload.title;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF0B1220' } };
  summary.mergeCells('A1:C1');

  let row = 3;
  if (payload.subtitle) {
    const sub = summary.getCell(`A${row}`);
    sub.value = payload.subtitle;
    sub.font = { italic: true, size: 11, color: { argb: 'FF64748B' } };
    summary.mergeCells(`A${row}:C${row}`);
    row += 1;
  }

  const generated = summary.getCell(`A${row}`);
  generated.value = `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`;
  generated.font = { size: 10, color: { argb: 'FF94A3B8' } };
  summary.mergeCells(`A${row}:C${row}`);
  row += 2;

  if (payload.thesis) {
    const thesisLabel = summary.getCell(`A${row}`);
    thesisLabel.value = 'AI thesis / rationale';
    thesisLabel.font = { bold: true, size: 11, color: { argb: 'FF0B1220' } };
    summary.mergeCells(`A${row}:C${row}`);
    row += 1;

    const thesisCell = summary.getCell(`A${row}`);
    thesisCell.value = payload.thesis;
    thesisCell.font = { size: 11, color: { argb: 'FF334155' } };
    thesisCell.alignment = { wrapText: true, vertical: 'top' };
    summary.mergeCells(`A${row}:C${row}`);
    summary.getRow(row).height = 80;
    row += 2;
  }

  // ── Allocation sheet ─────────────────────────────────────────────────────
  const ws = wb.addWorksheet('Allocation');
  ws.columns = [
    { header: 'Ticker', key: 'ticker', width: 10 },
    { header: 'Company', key: 'company', width: 26 },
    { header: 'Action', key: 'action', width: 10 },
    { header: 'Qty', key: 'qty', width: 12 },
    { header: 'Amount ($)', key: 'amountUsd', width: 14 },
    { header: 'Price ($)', key: 'price', width: 14 },
    { header: 'Line Total ($)', key: 'lineTotal', width: 16 },
    { header: 'Notes', key: 'note', width: 48 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } };
  headerRow.alignment = { vertical: 'middle' };

  const currencyNumFmt = '"$"#,##0.00';

  for (const r of payload.rows) {
    const rowValues: Array<string | number | null> = [
      r.ticker,
      r.company ?? null,
      ACTION_LABEL[r.action] ?? r.action,
      r.qty != null && Number.isFinite(r.qty) ? Math.round(r.qty * 10000) / 10000 : null,
      currencyCell(r.amountUsd),
      currencyCell(r.price),
      currencyCell(r.lineTotal ?? r.amountUsd),
      r.note ?? null,
    ];
    const added = ws.addRow(rowValues);
    added.getCell(5).numFmt = currencyNumFmt;
    added.getCell(6).numFmt = currencyNumFmt;
    added.getCell(7).numFmt = currencyNumFmt;
    if (r.action === 'sell') {
      added.getCell(3).font = { color: { argb: 'FFB91C1C' } };
    } else if (r.action === 'buy') {
      added.getCell(3).font = { color: { argb: 'FF15803D' } };
    }
  }

  // Grand total row
  const grandTotal =
    payload.grandTotal ??
    payload.rows.reduce((sum, r) => sum + (Number.isFinite(r.lineTotal) ? (r.lineTotal as number) : Number.isFinite(r.amountUsd) ? (r.amountUsd as number) : 0), 0);

  const totalRow = ws.addRow([
    '',
    '',
    '',
    '',
    '',
    'Grand Total',
    currencyCell(grandTotal),
    '',
  ]);
  totalRow.getCell(6).font = { bold: true };
  totalRow.getCell(7).font = { bold: true };
  totalRow.getCell(7).numFmt = currencyNumFmt;
  totalRow.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
