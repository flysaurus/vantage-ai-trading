import { parsePortfolioBlocks } from '@/lib/portfolio-blocks';
import type { ExportPayload, ExportRow } from './xlsx';

/**
 * Build a downloadable export payload from the STRUCTURED markers in an AI
 * response — [PORTFOLIO:{...}] allocation blocks, [POSITION:{...}] enrichment
 * cards, and [RECOMMEND:SYMBOL:ACTION:$AMOUNT] trade markers.
 *
 * This is the marker-gated path (complement to the deterministic rebalance
 * `planToExportPayload`): prose is NEVER parsed for numbers — only explicit
 * markers are consumed. Returns null when the response has no downloadable
 * structure, so the server can skip emitting a `download` event.
 */

/** Exchange-suffix stripping mirrors `parseSuggestions` (client) so the base US
 *  symbol is exported, not the foreign listing (e.g. "SAP.DE" → "SAP"). */
function baseSymbol(raw: string): string {
  const sym = raw.toUpperCase();
  const dotIdx = sym.lastIndexOf('.');
  if (dotIdx < 0) return sym;
  const suffix = sym.slice(dotIdx + 1);
  const validSingleChar = new Set(['A', 'B']);
  const strip = suffix.length >= 2 || (suffix.length === 1 && !validSingleChar.has(suffix));
  return strip ? sym.slice(0, dotIdx) : sym;
}

/** Self-contained [POSITION:{...}] parser (bracket-counting, no React imports).
 *  Returns ticker → { name?, thesis? } for enriching export rows. */
function parsePositionMeta(text: string): Map<string, { name?: string; thesis?: string }> {
  const meta = new Map<string, { name?: string; thesis?: string }>();
  const prefix = '[POSITION:{';
  let idx = 0;
  while ((idx = text.indexOf(prefix, idx)) !== -1) {
    let depth = 1;
    let pos = idx + prefix.length;
    while (pos < text.length && depth > 0) {
      const ch = text[pos];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      pos++;
    }
    const jsonText = text.slice(idx + prefix.length - 1, pos);
    try {
      const obj = JSON.parse(jsonText);
      if (obj && typeof obj === 'object' && typeof obj.ticker === 'string' && obj.ticker) {
        meta.set(obj.ticker.toUpperCase(), {
          name: typeof obj.name === 'string' ? obj.name : undefined,
          thesis: typeof obj.thesis === 'string' ? obj.thesis : undefined,
        });
      }
    } catch {
      // Malformed — skip
    }
    idx = pos;
  }
  return meta;
}

const RECOMMEND_RE = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):(BUY|SELL)(?::(\$?[\d,]+(?:\.\d+)?))?\]/g;

export function buildMarkerExportPayload(responseText: string): ExportPayload | null {
  const meta = parsePositionMeta(responseText);

  // ── Primary: [PORTFOLIO:{...}] allocation blocks ──
  const blocks = parsePortfolioBlocks(responseText);
  if (blocks.length > 0) {
    const rows: ExportRow[] = [];
    let grandTotal = 0;
    for (const b of blocks) {
      if (Number.isFinite(b.total) && b.total > 0) grandTotal += b.total;
      for (const p of b.positions) {
        const ticker = baseSymbol(p.symbol || '');
        if (!ticker || ticker === 'CASH' || p.isReserve) continue;
        const m = meta.get(ticker);
        const amount = Number.isFinite(p.amount) && p.amount > 0 ? Math.round(p.amount * 100) / 100 : null;
        rows.push({
          ticker,
          company: m?.name ?? null,
          action: p.side === 'sell' ? 'sell' : 'buy',
          amountUsd: amount,
          lineTotal: amount,
          note: m?.thesis ?? null,
        });
      }
    }
    if (rows.length > 0) {
      const single = blocks.length === 1;
      return {
        title: single && blocks[0].strategy ? blocks[0].strategy : 'Portfolio Build',
        subtitle: single ? null : `${blocks.length} strategies`,
        grandTotal: grandTotal > 0 ? Math.round(grandTotal * 100) / 100 : null,
        rows,
      };
    }
  }

  // ── Fallback: [RECOMMEND:SYMBOL:ACTION:$AMOUNT] markers ──
  const recRows: ExportRow[] = [];
  let recTotal = 0;
  for (const m of responseText.matchAll(RECOMMEND_RE)) {
    const ticker = baseSymbol(m[1]);
    const action: ExportRow['action'] = m[2] === 'SELL' ? 'sell' : 'buy';
    const rawQty = m[3] || '';
    let amountUsd: number | null = null;
    if (rawQty.startsWith('$')) {
      const v = parseFloat(rawQty.slice(1).replace(/,/g, ''));
      if (Number.isFinite(v) && v > 0) amountUsd = Math.round(v * 100) / 100;
    }
    const mm = meta.get(ticker);
    if (amountUsd != null) recTotal += amountUsd;
    recRows.push({
      ticker,
      company: mm?.name ?? null,
      action,
      amountUsd,
      lineTotal: amountUsd,
      note: mm?.thesis ?? null,
    });
  }

  if (recRows.length === 0) return null;

  return {
    title: 'Recommendations',
    subtitle: null,
    grandTotal: recTotal > 0 ? Math.round(recTotal * 100) / 100 : null,
    rows: recRows,
  };
}
