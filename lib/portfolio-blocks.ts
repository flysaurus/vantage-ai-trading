// ─── Portfolio Block Parser ──────────────────────────
// Shared module — safe for both server (route.ts) and client (AITab.tsx).
// Extracted from route.ts to avoid client-components importing server-only
// modules (next/headers, supabase, etc.) transitively.
// ─────────────────────────────────────────────────────

import { type PortfolioBlock } from '@/lib/portfolio-types';

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
      // Unclosed bracket — skip this match and continue
      const raw = response.slice(start);
      blocks.push({ total: NaN, positions: [], raw, parseError: 'Unclosed PORTFOLIO block — missing closing ]' });
      break;
    }

    const raw = response.slice(start, pos + 1);
    const jsonStr = raw.slice(prefix.length, -1); // strip [PORTFOLIO: and ]

    try {
      const parsed = JSON.parse(jsonStr);
      blocks.push({
        total: parsed.total,
        strategy: parsed.strategy,
        positions: Array.isArray(parsed.positions) ? parsed.positions : [],
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

  return blocks;
}
