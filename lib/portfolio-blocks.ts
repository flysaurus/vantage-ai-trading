// ─── Portfolio Block Parser ──────────────────────────
// Shared module — safe for both server (route.ts) and client (AITab.tsx).
// Extracted from route.ts to avoid client-components importing server-only
// modules (next/headers, supabase, etc.) transitively.
//
// Phase 1: handles CASH/reserve positions and explicit side (BUY/SELL).
// ─────────────────────────────────────────────────────

import { type PortfolioBlock, type PortfolioPosition } from '@/lib/portfolio-types';

/**
 * Find the index of the matching close-brace for an opening brace at openIdx.
 * Handles nested braces and strings. Returns -1 if unbalanced.
 */
function findBalancedBrace(text: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let pos = openIdx; pos < text.length; pos++) {
    const ch = text[pos];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return pos; }
  }
  return -1;
}

/** Map a raw strategy object into normalized positions. */
function mapPositions(rawPositions: any): PortfolioPosition[] {
  if (!Array.isArray(rawPositions)) return [];
  return rawPositions.map((p: any) => ({
    symbol: p.symbol || 'CASH',
    amount: typeof p.amount === 'number' ? p.amount : 0,
    side: p.side === 'sell' ? 'sell' as const : 'buy' as const,
    isReserve: p.symbol === 'CASH' || p.isReserve === true,
  }));
}

/** Parse all [PORTFOLIO:{...}] JSON blocks from the AI response. */
export function parsePortfolioBlocks(response: string): PortfolioBlock[] {
  const blocks: PortfolioBlock[] = [];
  const prefix = '[PORTFOLIO:';
  let idx = 0;

  while (idx < response.length) {
    const start = response.indexOf(prefix, idx);
    if (start === -1) break;

    // Bracket-count to find the matching ] (handles nested { and } in JSON)
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let pos = start + 1; // skip opening [
    for (; pos < response.length; pos++) {
      const ch = response[pos];
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === '\\') { escapeNext = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') { depth++; continue; }
      if (ch === '}') { if (depth > 0) depth--; continue; }
      if (ch === ']' && depth === 0) break;
    }

    if (pos >= response.length) {
      const raw = response.slice(start);
      blocks.push({ total: NaN, positions: [], raw, parseError: 'Unclosed PORTFOLIO block — missing closing ]' });
      break;
    }

    const raw = response.slice(start, pos + 1);
    const jsonStr = raw.slice(prefix.length, -1); // strip [PORTFOLIO: and ]

    try {
      const parsed = JSON.parse(jsonStr);
      const positions: PortfolioPosition[] = Array.isArray(parsed.positions)
        ? parsed.positions.map((p: any) => ({
            symbol: p.symbol || 'CASH',
            amount: typeof p.amount === 'number' ? p.amount : 0,
            side: p.side === 'sell' ? 'sell' as const : 'buy' as const,
            isReserve: p.symbol === 'CASH' || p.isReserve === true,
          }))
        : [];

      blocks.push({
        total: parsed.total,
        strategy: parsed.strategy,
        positions,
        raw,
      });
    } catch (e: any) {
      blocks.push({
        total: NaN,
        positions: [],
        raw,
        parseError: `Invalid JSON: ${e.message || 'unknown parse error'}`,
      });
    }

    idx = pos + 1;
  }

  // ── Raw strategy JSON fallback ──
  // The model sometimes emits {"strategies": [...]} instead of [PORTFOLIO:{...}].
  // Normalize so strategy cards render instead of raw JSON leaking to the user.
  idx = 0;
  while ((idx = response.indexOf('{"strategies"', idx)) !== -1) {
    // Back up to the opening {
    let openIdx = idx;
    while (openIdx > 0 && response[openIdx] !== '{') openIdx--;
    if (response[openIdx] !== '{') { idx += 1; continue; }
    const endIdx = findBalancedBrace(response, openIdx);
    if (endIdx === -1) break;
    const jsonStr = response.slice(openIdx, endIdx + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.strategies)) {
        for (const s of parsed.strategies) {
          const positions = mapPositions(s?.positions);
          blocks.push({
            total: typeof s?.total === 'number' ? s.total : positions.reduce((a: number, p) => a + p.amount, 0),
            strategy: s?.name || s?.strategy || s?.label,
            positions,
            raw: jsonStr,
          });
        }
      }
    } catch {
      // Malformed raw JSON — ignore, don't crash
    }
    idx = endIdx + 1;
  }

  return blocks;
}
