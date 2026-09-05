// ─── Client-safe download-payload derivation ─────────────────
// Reconstructs a downloadable-export payload from a persisted AI response's
// RAW content (chat_messages stores markers/table verbatim). Used at history
// hydration so Download buttons survive a page reload WITHOUT a schema change.
//
// Two sources:
//   1. Structured markers — [PORTFOLIO:{...}] / [POSITION:{...}] / [RECOMMEND:...]
//      → `buildMarkerExportPayload` (exact match to the server-emitted payload).
//   2. Deterministic rebalance plans — a markdown table (Action/Symbol/Holding/
//      Amount[/Target]) → parsed back into rows. Lighter than the live payload
//      (no per-leg qty/price — those live only in the server's RebalancePlan),
//      but preserves ticker / action / amount / company / grand total.
//
// Client-safe: no Node/fs/supabase imports (type-only from ./csv).
// ──────────────────────────────────────────────────────────────

import { buildMarkerExportPayload } from './marker-export';
import type { ExportPayload, ExportRow } from './csv';

const ACTION_SET: ReadonlySet<string> = new Set(['buy', 'sell', 'hold']);

/** Parse a rebalance markdown table (Action | Symbol | Holding | Amount) back
 *  into export rows. Never parses prose — only table rows with a recognized
 *  action in the first column. */
function parseRebalanceTableForExport(content: string): ExportPayload | null {
  const rows: ExportRow[] = [];
  let grandTotal = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    const parts = trimmed.split('|').map((p) => p.trim());
    const action = (parts[1] || '').toLowerCase();
    if (!ACTION_SET.has(action)) continue;

    const symbol = (parts[2] || '').replace(/\*\*/g, '').trim();
    if (!symbol) continue;

    const company = (parts[3] || '').trim() || null;
    const amountRaw = (parts[4] || '').replace(/[$,]/g, '').trim();
    const amount = parseFloat(amountRaw);
    const amountUsd = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;

    rows.push({
      ticker: symbol.toUpperCase(),
      company,
      action: action as ExportRow['action'],
      amountUsd,
      lineTotal: amountUsd,
    });
    if (amountUsd != null) grandTotal += amountUsd;
  }

  if (rows.length === 0) return null;

  const styleMatch = content.match(/rebalance plan to \*\*([^*]+)\*\*/);
  return {
    title: styleMatch?.[1] ? `Rebalance Plan — ${styleMatch[1].trim()}` : 'Rebalance Plan',
    subtitle: null,
    grandTotal: grandTotal > 0 ? Math.round(grandTotal * 100) / 100 : null,
    rows,
  };
}

/**
 * Derive a downloadable-export payload from a persisted AI message's raw
 * content. Returns null when the message has no downloadable structure.
 */
export function deriveDownloadPayload(content: string): ExportPayload | null {
  const marker = buildMarkerExportPayload(content);
  if (marker) return marker;
  return parseRebalanceTableForExport(content);
}
