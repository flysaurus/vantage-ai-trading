// ─── validateRecommendations() — Strict Server-Side Validation ────
// Sits between AI generation and rendering. Nothing reaches the user's
// screen without passing these checks. Called from /api/chat route.
//
// Checks (in order):
//   1. STRICT MARKER PARSING — only [RECOMMEND:SYMBOL:BUY:$AMOUNT]
//   2. EXACT-MATCH SYMBOL RESOLUTION — symbol must exist in Finnhub US cache
//   3. DEDUPE BY CANONICAL SYMBOL — no same-company duplicates
//   4. BUDGET RECONCILIATION — sum must be within 2% of requested budget
//
// Fail = reject and regenerate. Never partial render.

import { loadSymbolCache } from '@/lib/symbol-validator';
import { getCompanyProfile } from '@/lib/finnhub';

// Exchange/country-code suffixes that indicate non-US listings
const EXCHANGE_SUFFIXES = new Set([
  'DE', 'MX', 'SW', 'VI', 'SN', 'DU', 'HM', 'GLP', 'LN', 'L',
  'PA', 'SA', 'TO', 'CN', 'HK', 'JP', 'KR', 'BR', 'IN', 'AU',
  'AS', 'AX', 'TA', 'OL', 'IL', 'SG', 'TW', 'FR', 'IT', 'ES',
  'NL', 'BE', 'SE', 'NO', 'DK', 'FI', 'PT', 'AT', 'CH', 'GB',
  'IE', 'NZ', 'ZA', 'RU', 'TR', 'PL', 'CZ', 'HU', 'GR', 'LU',
]);

// ── Types ──

export interface ValidationFailure {
  check: 'marker_format' | 'symbol_resolution' | 'duplicate_company' | 'budget_reconciliation' | 'response_coherence';
  detail: string;
  offendingMarkers: string[];
}

export interface ValidatedSuggestion {
  symbol: string;
  side: 'BUY';
  amount: number;
}

interface ValidationSuccess {
  suggestions: ValidatedSuggestion[];
  total: number;
  count: number;
}

export type ValidationResult =
  | { ok: true; result: ValidationSuccess }
  | { ok: false; failures: ValidationFailure[] };

// ── Helpers ──

/** Strip exchange suffixes (.DE, .MX, etc.) to get canonical base symbol.
 *  Only .A and .B are legitimate US share classes (BRK.A, BRK.B).
 *  All other single-char suffixes (.F, .X, .Y) are foreign exchange → strip. */
function canonicalSymbol(raw: string): string {
  const upper = raw.toUpperCase();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx < 0) return upper;
  const suffix = upper.slice(dotIdx + 1);
  const validSingleChar = new Set(['A', 'B']);
  return (suffix.length >= 2 || !validSingleChar.has(suffix)) ? upper.slice(0, dotIdx) : upper;
}

/** Extract the dollar amount from a marker's $N suffix. Returns null if missing. */
function extractDollarAmount(marker: string): number | null {
  const m = marker.match(/\$?([\d,]+(?:\.[\d,]+)?)\]$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
}

// ── Core Validator ──

/**
 * Core validator. Accepts optional symbolCache override for testing.
 */
export async function validateRecommendations(
  rawText: string,
  requestedBudget: number | null,
  symbolCacheOverride?: Set<string>,
): Promise<ValidationResult> {
  const failures: ValidationFailure[] = [];

  // ────────────────────────────────────────────────────────
  // CHECK 1: Strict marker parsing
  // ────────────────────────────────────────────────────────
  // Dollar sign is optional per client regex; amounts allow commas
  const STRICT_MARKER = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):BUY:\$?([\d,]+(?:\.[\d,]+)?)\]/g;
  const ANY_MARKER_LIKE = /\[RECOMMEND:[^\]]*\]/g;

  const validMarkers: Array<{ raw: string; symbol: string; amount: number; canonical: string }> = [];

  // First: find ALL [RECOMMEND:...] tags and check each one
  for (const match of rawText.matchAll(ANY_MARKER_LIKE)) {
    const raw = match[0];
    // Test if it matches strict format by creating a fresh regex (avoid lastIndex issues)
    const STRICT_FORMAT = /^\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):BUY:\$?([\d,]+(?:\.[\d,]+)?)\]$/;
    if (STRICT_FORMAT.test(raw)) {
      const strictMatch = raw.match(STRICT_FORMAT);
      if (strictMatch) {
        const symbol = strictMatch[1];
        const amount = parseFloat(strictMatch[2].replace(/,/g, ''));
        validMarkers.push({
          raw,
          symbol,
          amount,
          canonical: canonicalSymbol(symbol),
        });
      }
    } else {
      failures.push({
        check: 'marker_format',
        detail: `Malformed or imprecise marker: "${raw}". Use exact format [RECOMMEND:SYMBOL:BUY:$AMOUNT] with dollar sign and numeric amount.`,
        offendingMarkers: [raw],
      });
    }
  }

  if (validMarkers.length === 0 && failures.length > 0) {
    return { ok: false, failures };
  }

  // ────────────────────────────────────────────────────────
  // CHECK 2: Exact-match symbol resolution (with live fallback)
  // ────────────────────────────────────────────────────────
  const symbolCache = symbolCacheOverride ?? (await loadSymbolCache());
  const unknownSymbols = new Set<string>();
  const liveVerified = new Map<string, boolean>(); // symbol → true (verified via live API)

  for (const m of validMarkers) {
    const sym = m.symbol.toUpperCase();
    if (symbolCache.size > 0 && !symbolCache.has(sym)) {
      unknownSymbols.add(sym);
    }
  }

  // Soft-fail: try live Finnhub profile lookup for cache misses
  if (unknownSymbols.size > 0 && !symbolCacheOverride) {
    console.log(`[validate] ${unknownSymbols.size} symbol(s) missing from cache — trying live lookup:`, [...unknownSymbols]);
    for (const sym of unknownSymbols) {
      try {
        const profile = await getCompanyProfile(sym);
        if (profile && profile.country === 'US' && profile.ticker) {
          liveVerified.set(sym.toUpperCase(), true);
          console.log(`[validate] Live lookup confirmed: ${sym} → ${profile.name} (${profile.exchange})`);
        } else {
          console.log(`[validate] Live lookup failed for ${sym}: ${profile ? `country=${profile.country}` : 'no profile'}`);
        }
      } catch (e: any) {
        console.warn(`[validate] Live lookup error for ${sym}: ${e?.message || e}`);
      }
    }
  }

  if (unknownSymbols.size > 0) {
    for (const sym of unknownSymbols) {
      // Skip if live lookup verified it
      if (liveVerified.has(sym.toUpperCase())) {
        console.log(`[validate] ${sym} rescued by live lookup — treating as valid`);
        continue;
      }
      // Check if it's a known exchange-code suffix issue
      const dotIdx = sym.lastIndexOf('.');
      if (dotIdx >= 0) {
        const suffix = sym.slice(dotIdx + 1);
        if (EXCHANGE_SUFFIXES.has(suffix.toUpperCase())) {
          const base = sym.slice(0, dotIdx);
          if (symbolCache.has(base) || liveVerified.has(base.toUpperCase())) {
            failures.push({
              check: 'symbol_resolution',
              detail: `"${sym}" is a foreign exchange listing (${suffix}). Use US primary listing "${base}" instead.`,
              offendingMarkers: validMarkers.filter(m => m.symbol === sym).map(m => m.raw),
            });
          } else {
            failures.push({
              check: 'symbol_resolution',
              detail: `"${sym}" is not a recognized US-traded symbol. Use resolveSymbol tool to find correct ticker.`,
              offendingMarkers: validMarkers.filter(m => m.symbol === sym).map(m => m.raw),
            });
          }
        } else {
          failures.push({
            check: 'symbol_resolution',
            detail: `"${sym}" is not a recognized US-traded symbol. Use resolveSymbol tool to find correct ticker.`,
            offendingMarkers: validMarkers.filter(m => m.symbol === sym).map(m => m.raw),
          });
        }
      } else {
        failures.push({
          check: 'symbol_resolution',
          detail: `"${sym}" is not a recognized US-traded symbol. Use resolveSymbol tool to find correct ticker.`,
          offendingMarkers: validMarkers.filter(m => m.symbol === sym).map(m => m.raw),
        });
      }
    }
    return { ok: false, failures };
  }

  // ────────────────────────────────────────────────────────
  // CHECK 3: Dedupe by canonical symbol
  // ────────────────────────────────────────────────────────
  const seen = new Map<string, string[]>(); // canonical → raw symbols
  for (const m of validMarkers) {
    const existing = seen.get(m.canonical);
    if (existing) {
      existing.push(m.symbol);
    } else {
      seen.set(m.canonical, [m.symbol]);
    }
  }

  const duplicates = [...seen.entries()].filter(([_, syms]) => syms.length > 1);
  if (duplicates.length > 0) {
    for (const [canon, syms] of duplicates) {
      failures.push({
        check: 'duplicate_company',
        detail: `Same company "${canon}" appears ${syms.length} times (${syms.join(', ')}). Each position gets exactly one marker.`,
        offendingMarkers: validMarkers.filter(m => m.canonical === canon).map(m => m.raw),
      });
    }
    return { ok: false, failures };
  }

  // ────────────────────────────────────────────────────────
  // CHECK 4: Budget reconciliation
  // ────────────────────────────────────────────────────────
  if (requestedBudget !== null && requestedBudget > 0) {
    const total = validMarkers.reduce((sum, m) => sum + m.amount, 0);
    const margin = requestedBudget * 0.02; // 2% tolerance
    const lowerBound = requestedBudget - margin;
    const upperBound = requestedBudget + margin;

    if (total < lowerBound || total > upperBound) {
      const direction = total < lowerBound ? 'under' : 'over';
      const pctOff = Math.abs(((total - requestedBudget) / requestedBudget) * 100).toFixed(1);
      failures.push({
        check: 'budget_reconciliation',
        detail: `Allocation total $${total.toLocaleString()} is ${direction} budget by ${pctOff}% (requested: $${requestedBudget.toLocaleString()}, allowed ±2%).`,
        offendingMarkers: validMarkers.map(m => m.raw),
      });
      return { ok: false, failures };
    }
  }

  // ────────────────────────────────────────────────────────
  // ALL CHECKS PASSED
  // ────────────────────────────────────────────────────────
  return {
    ok: true,
    result: {
      suggestions: validMarkers.map(m => ({ symbol: m.symbol, side: 'BUY' as const, amount: m.amount })),
      total: validMarkers.reduce((sum, m) => sum + m.amount, 0),
      count: validMarkers.length,
    },
  };
}

/**
 * Build a strict retry reminder for the system prompt.
 * Injected when the first response fails validation.
 */
export function buildRetryPrompt(failures: ValidationFailure[]): string {
  const lines: string[] = [];
  lines.push('\n\n⚠️ YOUR PREVIOUS RESPONSE FAILED VALIDATION. REGENERATE NOW:\n');

  for (const f of failures) {
    lines.push(`FAILED CHECK: ${f.check.replace(/_/g, ' ').toUpperCase()}`);
    lines.push(`  ${f.detail}`);
    lines.push(`  Offending markers: ${f.offendingMarkers.join(', ')}`);
    lines.push('');
  }

  lines.push('CRITICAL RULES (these MUST be followed — your response will be rejected otherwise):');
  lines.push('1. EXACTLY one [RECOMMEND:SYMBOL:BUY:$AMOUNT] marker per position. No variations, no alternatives.');
  lines.push('2. EVERY symbol must be a US primary listing — use the resolveSymbol tool to verify before recommending.');
  lines.push('3. Dollar amounts must sum to EXACTLY the requested budget (within 2%).');
  lines.push('4. No exchange suffixes (.DE, .MX, .SW, etc.) — US listings only.');
  lines.push('5. No duplicate positions for the same company.');
  lines.push('6. Start with [SUMMARY_TLDR:...] marker.');
  lines.push('7. ONE coherent response. Do NOT include multiple portfolio tables, contradictory totals, "X or Y or Z" decision chains, or internal monologue ("Confirmed tickers", "All buttons"). Make definitive picks and present them ONCE.');
  lines.push('\nRegenerate your response now, following ALL rules above precisely.\n');

  return lines.join('\n');
}

/** Extract a dollar budget from user message if present. Returns null if unclear. */
export function extractBudget(message: string): number | null {
  // Patterns that capture a dollar amount in a portfolio-building context.
  // Key insight: use [^\$]* (non-greedy) instead of \s* to skip over
  // intervening words like "me a" or "5-year tech" between tokens.
  const dollarPatterns = [
    // "Build/Create/Make a $X portfolio" — skips any text until $
    /(?:build|create|make|design|suggest|recommend)[^\$]*\$([\d,]+(?:\.\d+)?)/i,
    // "$X budget|portfolio|invest|allocat|split" — flexible intervening text AFTER $
    /\$([\d,]+(?:\.\d+)?)[^\$]{0,30}(?:budget|portfolio|invest|allocat|split|across)/i,
    // Keyword BEFORE $ — "want to invest $X", "allocating $X", "portfolio of $X"
    /(?:invest|allocat|portfolio|budget)[^\$]{0,30}\$([\d,]+(?:\.\d+)?)/i,
    // "$X into|for|worth" — amount followed by action preposition
    /\$([\d,]+)[^\$]{0,15}(?:into|for|worth|across|split)/i,
    // "budget|portfolio|amount is/of/: $X" — keyword then amount
    /(?:budget|portfolio|amount)\s*(?:is|of|:|for)\s*\$([\d,]+(?:\.\d+)?)/i,
    // "10k", "1.5k" notation
    /(\d+[\.\/]\d*)\s*k\b/i,
  ];

  for (const pattern of dollarPatterns) {
    const match = message.match(pattern);
    if (match) {
      const raw = match[1].replace(/,/g, '');
      const num = parseFloat(raw);
      if (!isNaN(num) && num > 0) {
        // Check if "k" modifier applies
        if (/k\b/i.test(message.slice(match.index!))) {
          return num * 1000;
        }
        return num;
      }
    }
  }

  // Check for "k" pattern separately
  const kMatch = message.match(/(\d+(?:\.\d+)?)\s*[kK]\b/);
  if (kMatch) {
    const num = parseFloat(kMatch[1]);
    if (!isNaN(num) && num > 0) return num * 1000;
  }

  return null;
}
