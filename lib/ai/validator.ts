// ─── AI Advisor Validator ────────────────────────────────────────
// Phase 4: Unified validation pipeline.
//
// Before Phase 4, validation ran as 4+ separate passes sprinkled across
// the chat route and multiple modules. This module provides a single
// entry point: validateResponse().
//
// Pass 1: Sanitization (foreign suffix stripping, trailing question cleanup)
// Pass 2: Incoherence detection (CLARIFY violations, monologue leaking, duplicates)
// Pass 3: PORTFOLIO block validation (internal consistency, marker cross-check)
// Pass 4: Strict recommendation validation (symbol resolution, dedupe, budget)
// Pass 5: Budget gate (secondary guard — runs only if Pass 4 didn't reject)
//
// Each pass produces zero or more issues. validateResponse() returns
// a single ValidationReport with all issues and an overall pass/fail.
// ──────────────────────────────────────────────────────────────────

import { FOREIGN_EXCHANGE_SUFFIXES } from '@/lib/symbol-resolution';

// ── Types ─────────────────────────────────────────────────

export type ValidationPass = 'sanitization' | 'incoherence' | 'portfolio_block' | 'strict_recommendation' | 'budget_gate';

export type IssueSeverity = 'fatal' | 'warning';

export interface ValidationIssue {
  pass: ValidationPass;
  severity: IssueSeverity;
  message: string;
  detail?: string;
  correctedText?: string;
}

export interface ValidationReport {
  /** Whether the response is acceptable as-is (no fatal issues) */
  ok: boolean;
  /** All issues found, ordered by pass */
  issues: ValidationIssue[];
  /** Sanitized response text (foreign suffixes stripped, trailing questions removed) */
  sanitizedText: string;
  /** Number of tickers that had foreign suffixes stripped */
  suffixesStripped: number;
  /** Has PORTFOLIO blocks (controls downstream rendering) */
  hasPortfolioBlocks: boolean;
  /** Has RECOMMEND markers (controls trade button rendering) */
  hasRecommendMarkers: boolean;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Run the full validation pipeline against an AI response.
 *
 * @param responseText - Raw AI response text
 * @param requestedBudget - Budget extracted from user conversation (null if not a portfolio request)
 * @returns Unified validation report
 */
export function validateResponse(
  responseText: string,
  requestedBudget: number | null = null,
): ValidationReport {
  const issues: ValidationIssue[] = [];

  // ── Pass 1: Sanitization ──
  const { text: sanitized, count: suffixesStripped } = stripForeignSuffixes(responseText);
  const sanitizedText = stripTrailingQuestions(sanitized);

  if (suffixesStripped > 0) {
    console.log(`[validator] Pass 1: Stripped ${suffixesStripped} foreign exchange suffixes`);
  }
  if (sanitizedText !== sanitized) {
    console.log('[validator] Pass 1: Removed trailing questions from response');
  }

  // ── Pass 2: Incoherence detection ──
  const incoherence = detectIncoherence(sanitizedText, requestedBudget);
  if (incoherence) {
    issues.push({ pass: 'incoherence', severity: 'fatal', message: incoherence });
  }

  // ── Pass 3: PORTFOLIO block validation ──
  const blockError = validatePortfolioBlockConsistency(sanitizedText, requestedBudget);
  if (blockError) {
    issues.push({ pass: 'portfolio_block', severity: 'fatal', message: blockError });
  }

  // ── Check for markers (used by caller to decide downstream validation) ──
  const hasRecommendMarkers = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:(?:BUY|SELL)/i.test(sanitizedText);
  const hasPortfolioBlocks = /\[PORTFOLIO:\{/i.test(sanitizedText);

  return {
    ok: issues.filter(i => i.severity === 'fatal').length === 0,
    issues,
    sanitizedText,
    suffixesStripped,
    hasPortfolioBlocks,
    hasRecommendMarkers,
  };
}

// ── Pass 1: Sanitization ──────────────────────────────────

/**
 * Strip known foreign exchange suffixes from RECOMMEND markers.
 * The AI sometimes hallucinates tickers like JNJ.DE, PFE.MX, NVDA.VI
 * despite explicit system-prompt forbidding. This sanitizer catches those
 * BEFORE validation runs, so the response passes instead of being rejected.
 */
export function stripForeignSuffixes(text: string): { text: string; count: number } {
  let count = 0;
  const result = text.replace(
    /\[RECOMMEND:([A-Z]{1,5})\.([A-Z]{1,3}):([A-Z]+):(\$?\d*)\]/g,
    (match, symbol: string, suffix: string, action: string, amount: string) => {
      if (FOREIGN_EXCHANGE_SUFFIXES.has(suffix.toUpperCase())) {
        if (/^[A-Z]{2,5}$/.test(symbol)) {
          console.warn(`[validator] 🔧 Stripped foreign suffix "${suffix}" from "${symbol}.${suffix}" → "${symbol}"`);
          count++;
          return `[RECOMMEND:${symbol}:${action}:${amount}]`;
        }
      }
      return match;
    }
  );
  return { text: result, count };
}

/**
 * Strip trailing questions / conversational sign-offs from the AI response.
 * The AI often appends "How does that look?" or "Would you like more details?"
 * which is nice but inconsistent with the CLARIFY contract.
 */
export function stripTrailingQuestions(text: string): string {
  // Remove trailing standalone question sentences
  const trailPatterns = [
    /(\n|\r\n)?[Hh]ow does that (?:look|sound|feel)\??\s*$/,
    /(\n|\r\n)?[Ww]ould you like (?:me to|more|further|add)\s*[^.]*\??\s*$/,
    /(\n|\r\n)?[Ll]et me know if [^.]*\??\s*$/,
    /(\n|\r\n)?[Dd]oes that (?:help|make sense|work|sound good)\??\s*$/,
    /(\n|\r\n)?[Aa]ny questions?\??\s*$/,
    /(\n|\r\n)?[Ww]hat (?:do you think|would you like)\??\s*$/,
    /(\n|\r\n)?[Ww]ould (?:this|that) (?:work|be okay|be helpful)\??\s*$/,
  ];
  
  let cleaned = text;
  for (const pattern of trailPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trimEnd();
}

// ── Pass 2: Incoherence detection ─────────────────────────

const INTERNAL_MONOLOGUE_PATTERNS = [
  /^(?:Hmm|Let me|I should|I need to|I'll start|First, I'll|Let's see|Okay,|Alright,|Wait,|Actually,|I think I|I realize)/m,
  /(?:the user wants|the user asked|the user is asking|the user requested)\b/i,
  /(?:my instructions|my system prompt|my guidelines) say\b/i,
  /I need to (?:recommend|provide|suggest|offer|build|construct)/i,
  /Let me (?:know if|check|verify|double.check|make sure)/i,
  /(?:according to my|per my|my)\s*(?:training|knowledge|understanding)/i,
];

const DUPLICATE_TLDR_RE = /\[SUMMARY_TLDR:[^\]]*\]/gi;

const PROSE_QUESTION_PATTERNS = [
  // X or Y or Z without CLARIFY wrapper
  /(?:^|\n)(?:would you prefer|do you prefer|would you rather)\s+[\s\S]*? or [\s\S]*?\?/im,
  // "Do you want X, Y, or Z?" without CLARIFY
  /(?:^|\n)(?:do you want|would you like)\s+[\s\S]*?[?,]\s*or\s+[\s\S]*?\?/im,
];

/**
 * Detect AI response incoherence that isn't caught by PORTFOLIO block validation.
 * Covers: internal monologue leaking, duplicate SUMMARY_TLDR, prose questions
 * outside CLARIFY blocks, alternatives outside CLARIFY blocks.
 */
export function detectIncoherence(response: string, requestedBudget?: number | null): string | null {
  // ── Internal monologue check ──
  // Only reject monologue leakage when the response has NO actionable markers.
  // If the AI already produced RECOMMEND or PORTFOLIO blocks, a casual "Hmm"
  // or "Let me" prefix is harmless — rejecting it just breaks valid single-stock buys.
  const hasActionableMarkers = /\[RECOMMEND:|\[PORTFOLIO:\{/i.test(response);
  if (!hasActionableMarkers) {
    for (const pattern of INTERNAL_MONOLOGUE_PATTERNS) {
      if (pattern.test(response)) {
        return `Internal monologue leaking in response. Remove all meta-commentary about your reasoning process.`;
      }
    }
  }

  // Check for duplicate SUMMARY_TLDR blocks
  const tldrMatches = response.match(DUPLICATE_TLDR_RE);
  const tldrCount = (tldrMatches || []).length;
  if (tldrCount > 1) {
    return `Found ${tldrCount} [SUMMARY_TLDR:...] blocks — only ONE is allowed. Consolidate into a single summary.`;
  }
  if (tldrCount === 1 && !response.includes('RECOMMEND:') && !response.includes('PORTFOLIO:')) {
    return `Found [SUMMARY_TLDR:...] block but no trade recommendations — the TLDR summary is only for portfolio responses. Remove it or add trade recommendations.`;
  }

  // Check for prose/alternative questions outside CLARIFY blocks
  // Same guard as monologue: if actionable markers exist, prose questions are harmless.
  // The model might add "Want me to use a limit order?" after a [RECOMMEND:...] marker.
  if (!/\[CLARIFY:\{/i.test(response) && !hasActionableMarkers) {
    for (const pattern of PROSE_QUESTION_PATTERNS) {
      if (pattern.test(response)) {
        return `Prose question detected outside [CLARIFY:{...}] block. All questions MUST use the CLARIFY contract: [CLARIFY:{"question":"...","options":[...]}]`;
      }
    }

    // Detect single prose questions (ends with ? — but only when no CLARIFY block)
    const proseQuestions = response.match(/(?:^|\n)([A-Z][^.!]+\?)/gm);
    if (proseQuestions && proseQuestions.length >= 2) {
      return `Found ${proseQuestions.length} prose questions outside [CLARIFY:...] blocks. Wrap ALL questions in CLARIFY blocks.`;
    }
  }

  return null;
}

// ── Pass 3: PORTFOLIO block validation ─────────────────────

/**
 * Lightweight PORTFOLIO block validator.
 * Checks JSON parseability, schema conformance, internal arithmetic,
 * and cross-reference with RECOMMEND markers. For full validation
 * including Finnhub symbol checks, use validateRecommendations() from
 * @/lib/validate-recommendations.
 */
export function validatePortfolioBlockConsistency(
  response: string,
  requestedBudget?: number | null,
): string | null {
  // Extract PORTFOLIO blocks
  const re = /\[PORTFOLIO:\s*(\{[\s\S]*?\})\]/g;
  const blocks: any[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(response)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      return `[PORTFOLIO:...] block parse error: invalid JSON at "${m[1].slice(0, 80)}..."`;
    }
  }

  if (blocks.length === 0) return null; // No blocks = nothing to validate

  const isMultiBlock = blocks.length > 1;

  // Validate each block
  for (const block of blocks) {
    const label = block.strategy ? `"${block.strategy}" ` : '';

    if (typeof block.total !== 'number' || isNaN(block.total) || block.total <= 0) {
      return `[PORTFOLIO:...] ${label}block has invalid total. Must be a positive number.`;
    }
    if (!Array.isArray(block.positions) || block.positions.length === 0) {
      return `[PORTFOLIO:...] ${label}block has missing/empty positions array.`;
    }
    for (const pos of block.positions) {
      if (!pos.symbol || typeof pos.symbol !== 'string') {
        return `[PORTFOLIO:...] ${label}block has position with missing/invalid symbol.`;
      }
      if (typeof pos.amount !== 'number' || isNaN(pos.amount) || pos.amount <= 0) {
        return `[PORTFOLIO:...] ${label}block position "${pos.symbol}" has invalid amount.`;
      }
    }
    const sum = block.positions.reduce((acc: number, p: any) => acc + p.amount, 0);
    if (Math.abs(sum - block.total) > 0.01) {
      return `[PORTFOLIO:...] ${label}block sum ($${sum.toLocaleString()}) ≠ total ($${block.total.toLocaleString()}).`;
    }
    const symbols = block.positions.map((p: any) => p.symbol.toUpperCase());
    if (new Set(symbols).size !== symbols.length) {
      return `[PORTFOLIO:...] ${label}block has duplicate symbols.`;
    }
  }

  // Multi-block budget check
  if (isMultiBlock && requestedBudget && requestedBudget > 0) {
    for (const block of blocks) {
      if (Math.abs(block.total - requestedBudget) > 0.01) {
        return `[PORTFOLIO:...] block total ($${block.total.toLocaleString()}) ≠ requested budget ($${requestedBudget.toLocaleString()}).`;
      }
    }
  }

  // Cross-check: RECOMMEND markers should exist
  const hasBuy = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:BUY/i.test(response);
  const hasSell = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:SELL/i.test(response);
  if (!hasBuy && !hasSell) {
    console.log('[validator] ⚠️ PORTFOLIO blocks present but no RECOMMEND markers');
    return null; // Warning, not fatal — trade buttons will be missing but response is valid
  }

  return null;
}
