/**
 * Downloadable-export (CSV) generation for AI Advisor structured responses.
 * This is the SINGLE shared implementation consumed by:
 *   1. the chat AI Advisor Download button (rebalance plans, portfolio builds,
 *      basket previews, position/analysis responses), and
 *   2. the read-only-account rebalance/DCA "download the plan" path.
 *
 * The payload is deliberately presentation-agnostic: callers pass structured
 * rows + an optional thesis, and this module owns the CSV layout/escaping.
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
  /** Overall AI thesis/rationale commentary (kept in the chat; not in the CSV table). */
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

/** Sanitize a title into a safe, ASCII filename stem (no extension). */
export function exportFilenameStem(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'vantage-export';
}

/** Escape a single CSV field: quote only when it contains a comma, quote,
 *  newline or carriage return (and double any embedded quotes). */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Format a numeric cell rounded to `dp` decimals; empty string for null/invalid. */
function fmtNum(value: number | null | undefined, dp: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  const factor = 10 ** dp;
  return String(Math.round(value * factor) / factor);
}

/**
 * Build a CSV string from an export payload. Single flat table (allocation
 * rows + a grand-total row); the title/subtitle/thesis remain in the chat
 * (the title also drives the filename). Returns the CSV WITHOUT a BOM — the
 * HTTP route prepends one for Excel/UTF-8 friendliness.
 */
export function buildExportCsv(payload: ExportPayload): string {
  const header = ['Ticker', 'Company', 'Action', 'Qty', 'Amount ($)', 'Price ($)', 'Line Total ($)', 'Notes'];
  const lines: string[] = [header.map(csvField).join(',')];

  for (const r of payload.rows) {
    const line: Array<string | number | null> = [
      r.ticker,
      r.company ?? null,
      ACTION_LABEL[r.action] ?? r.action,
      fmtNum(r.qty, 4),
      fmtNum(r.amountUsd, 2),
      fmtNum(r.price, 2),
      fmtNum(r.lineTotal ?? r.amountUsd, 2),
      r.note ?? null,
    ];
    lines.push(line.map(csvField).join(','));
  }

  const grandTotal =
    payload.grandTotal ??
    payload.rows.reduce(
      (sum, r) =>
        sum +
        (Number.isFinite(r.lineTotal)
          ? (r.lineTotal as number)
          : Number.isFinite(r.amountUsd)
            ? (r.amountUsd as number)
            : 0),
      0,
    );

  lines.push(['', '', '', '', '', 'Grand Total', fmtNum(grandTotal, 2), ''].map(csvField).join(','));

  return lines.join('\n') + '\n';
}
