// ─── DEPRECATED: resolveSymbol AI Tool ─────────────────────────────
// This module is now a thin wrapper around lib/symbol-resolution.ts.
// All Finnhub logic lives in symbol-resolution.ts (single authority).
//
// The tool definition format is preserved for the Anthropic tool-use protocol.
// Actual resolution is delegated to resolveCompanyName() from symbol-resolution.ts.
// ──────────────────────────────────────────────────────────────────

import { resolveCompanyName, type ResolvedSymbol } from '@/lib/symbol-resolution';

/**
 * Resolve a company name to US-traded ticker symbol(s).
 * Delegates to symbol-resolution.ts — the single authority for all symbol resolution.
 *
 * Returns a JSON string matching the Anthropic tool-result format:
 *   match_type: 'single'  → one definitive US-listed match
 *   match_type: 'multiple' → several candidates, needs disambiguation
 *   match_type: 'none'     → no US match found
 */
export async function resolveSymbol(companyName: string): Promise<string> {
  if (!companyName?.trim()) {
    return JSON.stringify({
      match_type: 'none', candidates: [], primary_symbol: null,
      query: companyName || '', error: 'Empty query',
    });
  }

  try {
    const candidates: ResolvedSymbol[] = await resolveCompanyName(companyName, { maxCandidates: 5 });

    if (candidates.length === 0) {
      return JSON.stringify({
        match_type: 'none', candidates: [], primary_symbol: null,
        query: companyName,
      });
    }

    const mapped = candidates.map(c => ({
      symbol: c.symbol,
      name: c.name,
      exchange: c.exchange || 'Unknown',
      type: 'common stock',
    }));

    if (mapped.length === 1) {
      return JSON.stringify({
        match_type: 'single',
        candidates: mapped,
        primary_symbol: mapped[0].symbol,
        query: companyName,
      });
    }

    return JSON.stringify({
      match_type: 'multiple',
      candidates: mapped,
      primary_symbol: null,
      query: companyName,
    });
  } catch (err: any) {
    return JSON.stringify({
      match_type: 'none', candidates: [], primary_symbol: null,
      query: companyName, error: err.message || 'Unknown error',
    });
  }
}
