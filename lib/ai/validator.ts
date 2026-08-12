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
 * Strip RECOMMEND markers from responses that also contain CLARIFY blocks.
 * CLARIFY is a question — RECOMMEND markers alongside it create a
 * contradictory UI ("Which approach?" + live buy buttons).
 *
 * This is a HARD guarantee: CLARIFY + RECOMMEND cannot coexist in output.
 * Called from validateResponse() before any other processing.
 */
export function stripRecommendFromClarify(text: string): { text: string; stripped: number } {
  if (!/\[CLARIFY:/i.test(text)) return { text, stripped: 0 };
  const matches = text.match(/\[RECOMMEND:[^\]]*\]/g);
  const stripped = matches ? matches.length : 0;
  if (stripped > 0) {
    console.warn(`[validator] 🚫 Stripped ${stripped} RECOMMEND markers from CLARIFY response`);
    return { text: text.replace(/\[RECOMMEND:[^\]]*\]/g, ''), stripped };
  }
  return { text, stripped: 0 };
}

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
  // CLARIFY responses must never carry RECOMMEND markers (open question + live
  // buy buttons is a UI contradiction). Strip markers, keep PORTFOLIO blocks
  // so selectable strategy cards can still render ("no live buttons until tapped").
  const clarifyStrip = stripRecommendFromClarify(sanitized);
  const sanitizedText = stripTrailingQuestions(clarifyStrip.text);

  if (suffixesStripped > 0) {
    console.log(`[validator] Pass 1: Stripped ${suffixesStripped} foreign exchange suffixes`);
  }
  if (clarifyStrip.stripped > 0) {
    console.log(`[validator] Pass 1: Stripped ${clarifyStrip.stripped} RECOMMEND markers from CLARIFY response`);
  }
  if (sanitizedText !== clarifyStrip.text) {
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

// Legitimate CLARIFY lead-ins ("I need to clarify…", "Let me confirm…") are
// user-facing questions, NOT reasoning-process leakage. The system prompt allows a
// brief prose lead-in before a [CLARIFY:{...}] block, so exclude those verbs from
// the opening "thinking words" pattern below (which is what was falsely flagging
// CLARIFY responses and triggering a silent regenerate loop).
const INTERNAL_MONOLOGUE_PATTERNS = [
  /^(?!(?:Let me|I (?:should|need to))\s+(?:clarify|ask|confirm|understand|know)\b)(?:Hmm|Let me|I should|I need to|I'll start|First, I'll|Let's see|Okay,|Alright,|Wait,|Actually,|I think I|I realize)/m,
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
  // If the AI already produced RECOMMEND, PORTFOLIO, or CLARIFY blocks, a casual
  // "Hmm" / "Let me" / "I need to pin down…" lead-in is harmless — rejecting it
  // just breaks valid single-stock buys and legitimate CLARIFY responses.
  const hasActionableMarkers = /\[RECOMMEND:|\[PORTFOLIO:\{|\[CLARIFY:\{/i.test(response);
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

  // ── Computed-metric coherence ──
  // Extends the contradictory-totals check beyond dollar amounts: if a computed
  // metric (yield, expense ratio, P/E, etc.) is stated in both the SUMMARY_TLDR
  // and the prose body with conflicting values, that's the same class of bug.
  const metricIncoherence = detectMetricIncoherence(response);
  if (metricIncoherence) return metricIncoherence;

  return null;
}

// ── Computed-metric coherence helpers ─────────────────────

// Labels for metrics that can be "computed" and stated as a number.
// Ordered longest-first so "dividend yield" matches before "yield".
const COMPUTED_METRIC_LABELS = [
  'dividend yield',
  'expense ratio',
  'price-to-earnings',
  'p/e ratio',
  'pe ratio',
  'annualized return',
  'total return',
  'interest rate',
  'yield',
  'volatility',
  'cagr',
  'sharpe',
  'coupon',
  'alpha',
  'beta',
  'fee',
  'expense',
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract metric-label → numeric-value pairs from a body of text.
 * Handles both "2.4% yield" (value before label) and "yield of 2.4%"
 * (value after label) forms.
 */
function extractMetricValues(text: string): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const labelsAlt = COMPUTED_METRIC_LABELS.map(escapeRegex).join('|');

  const add = (rawLabel: string, value: number) => {
    if (!Number.isFinite(value)) return;
    const key = rawLabel.toLowerCase();
    if (!result.has(key)) result.set(key, []);
    result.get(key)!.push(value);
  };

  // "2.4% yield" / "4.8% dividend yield" — value then label
  const beforeRe = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*(\\b(?:${labelsAlt})\\b)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = beforeRe.exec(text)) !== null) add(m[2], parseFloat(m[1]));

  // "yield of 2.4%" / "expense ratio 0.15%" — label then value
  const afterRe = new RegExp(`(\\b(?:${labelsAlt})\\b)\\s*(?:of|is|at|~|≈|:|=|was)?\\s*~?\\s*(\\d+(?:\\.\\d+)?)\\s*%`, 'gi');
  while ((m = afterRe.exec(text)) !== null) add(m[1], parseFloat(m[2]));

  return result;
}

/**
 * Two values of the same metric conflict if they differ materially:
 * >0.5 percentage points AND >10% relative. Tolerates trivial rounding.
 */
function metricValuesConflict(a: number, b: number): boolean {
  const absDiff = Math.abs(a - b);
  const relDiff = absDiff / Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return absDiff > 0.5 && relDiff > 0.1;
}

/**
 * Flag contradictory computed metrics between the SUMMARY_TLDR and prose body.
 * Example: "2.4% yield" in the body vs "4.8% yield" in the TLDR is the same
 * class of bug as the $10,000-vs-$9,500 dollar-total contradiction.
 */
export function detectMetricIncoherence(response: string): string | null {
  const tldrMatch = response.match(/\[SUMMARY_TLDR:([^\]]*)\]/i);
  if (!tldrMatch) return null;
  const tldrText = tldrMatch[1];

  // Body = everything except structured markers (SUMMARY_TLDR, RECOMMEND,
  // PORTFOLIO, CLARIFY) — so prose math isn't confused with marker numbers.
  const bodyText = response
    .replace(/\[SUMMARY_TLDR:[^\]]*\]/gi, ' ')
    .replace(/\[RECOMMEND:[^\]]*\]/gi, ' ')
    .replace(/\[PORTFOLIO:\{[\s\S]*?\}\]/gi, ' ')
    .replace(/\[CLARIFY:\{[\s\S]*?\}\]/gi, ' ');

  const tldrMetrics = extractMetricValues(tldrText);
  const bodyMetrics = extractMetricValues(bodyText);

  for (const [label, tldrVals] of tldrMetrics) {
    const bodyVals = bodyMetrics.get(label);
    if (!bodyVals || bodyVals.length === 0) continue;
    for (const tv of tldrVals) {
      for (const bv of bodyVals) {
        if (metricValuesConflict(tv, bv)) {
          return `Contradictory computed metric "${label}": TLDR states ${tv}% but body states ${bv}%. Computed metrics must agree between the summary and the body.`;
        }
      }
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
