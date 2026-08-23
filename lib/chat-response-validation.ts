// Chat response validation helpers — moved out of app/api/chat/route.ts so
// the route file only exports HTTP handlers + Next config (Next.js route
// type generation rejects non-handler exports).
import { parsePortfolioBlocks } from '@/lib/portfolio-blocks';
import { FOREIGN_EXCHANGE_SUFFIXES } from '@/lib/symbol-resolution';

/**
 * Validate all [PORTFOLIO:{...}] blocks for internal consistency and
 * cross-check against [RECOMMEND:...] markers. PORTFOLIO blocks are the
 * authoritative source of truth — prose is NEVER parsed for numbers.
 *
 * Returns null if all blocks valid, or an error string describing the first failure.
 */
export function validatePortfolioBlocks(response: string, requestedBudget?: number | null): string | null {
  const blocks = parsePortfolioBlocks(response);

  // No PORTFOLIO blocks — caller should fall through to remaining prose checks
  if (blocks.length === 0) return null;

  const isMultiBlock = blocks.length > 1;

  // ── Check for parse errors ──
  for (const block of blocks) {
    if (block.parseError) {
      return `[PORTFOLIO:...] block parse error: ${block.parseError}. Use the exact format: [PORTFOLIO:{"total":10000,"positions":[{"symbol":"QQQ","amount":3000}]}]`;
    }
  }

  // ── Validate each block's internal consistency ──
  for (const block of blocks) {
    const label = block.strategy ? `"${block.strategy}" ` : '';

    // total must be a positive number
    if (typeof block.total !== 'number' || isNaN(block.total) || block.total <= 0) {
      return `[PORTFOLIO:...] ${label}block has invalid total: ${JSON.stringify(block.total)}. Total must be a positive integer.`;
    }

    // positions must be a non-empty array
    if (!Array.isArray(block.positions) || block.positions.length === 0) {
      return `[PORTFOLIO:...] ${label}block has missing or empty positions array. Include at least one {symbol, amount} object.`;
    }

    // Each position must have symbol and amount
    for (const pos of block.positions) {
      if (!pos.symbol || typeof pos.symbol !== 'string') {
        return `[PORTFOLIO:...] ${label}block has a position with missing or invalid symbol: ${JSON.stringify(pos)}`;
      }
      if (typeof pos.amount !== 'number' || isNaN(pos.amount) || pos.amount <= 0) {
        return `[PORTFOLIO:...] ${label}block position "${pos.symbol}" has invalid amount: ${pos.amount}. Amount must be a positive number.`;
      }
    }

    // Sum of position amounts must equal total
    const sum = block.positions.reduce((acc, p) => acc + p.amount, 0);
    if (Math.abs(sum - block.total) > 0.01) {
      return `[PORTFOLIO:...] ${label}block position sum ($${sum.toLocaleString()}) does not match total ($${block.total.toLocaleString()}). Adjust positions or total so they match exactly.`;
    }

    // No duplicate symbols within a block
    const symbols = block.positions.map(p => p.symbol.toUpperCase());
    const seen = new Set<string>();
    for (const sym of symbols) {
      if (seen.has(sym)) {
        return `[PORTFOLIO:...] ${label}block has duplicate symbol "${sym}". Each symbol may appear only once per block.`;
      }
      seen.add(sym);
    }
  }

  // ── Multi-strategy per-block budget check ──
  // Each block independently totals to the user's requested budget.
  // Skip this check if no budget is available (single-block responses handle it downstream).
  if (isMultiBlock && requestedBudget && requestedBudget > 0) {
    for (const block of blocks) {
      if (Math.abs(block.total - requestedBudget) > 0.01) {
        const label = block.strategy ? `"${block.strategy}" ` : '';
        return `[PORTFOLIO:...] ${label}block total ($${block.total.toLocaleString()}) does not match requested budget ($${requestedBudget.toLocaleString()}). In a multi-strategy response, every strategy must use the full requested budget.`;
      }
    }
  }

  // ── Cross-check with RECOMMEND markers ──
  // Supports both BUY and SELL markers. BUY markers describe new positions
  // (amount = PORTFOLIO position amount). SELL markers describe trim/reduce
  // operations on existing holdings (amount = sell amount, NOT the PORTFOLIO
  // position amount which reflects the post-trim holding).
  const hasBuyMarkers = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:BUY:\$?[\d,]+/i.test(response);
  const hasSellMarkers = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:SELL:\$?[\d,]+/i.test(response);
  if (!hasBuyMarkers && !hasSellMarkers) {
    // No RECOMMEND markers at all — but PORTFOLIO blocks exist and are valid.
    // This is a warning situation: the blocks define positions, but there are
    // no trade buttons. Graceful degradation — not a rejection.
    console.log('[validatePortfolioBlocks] ⚠️ PORTFOLIO blocks present but no RECOMMEND markers — trade buttons will be missing');
    return null;
  }

  // ── Extract BUY markers (amount = PORTFOLIO position amount) ──
  const buyPairs: { symbol: string; amount: number }[] = [];
  const seenMarkers = new Set<string>();
  const buyRe = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):BUY:\$?([\d,]+(?:\.[\d]+)?)\]/gi;
  let mkMatch: RegExpExecArray | null;
  while ((mkMatch = buyRe.exec(response)) !== null) {
    const raw = mkMatch[0];
    if (seenMarkers.has(raw)) continue;
    seenMarkers.add(raw);
    const rawSymbol = mkMatch[1].toUpperCase();
    const amount = parseFloat(mkMatch[2].replace(/,/g, ''));
    const dotIdx = rawSymbol.lastIndexOf('.');
    const suffix = dotIdx >= 0 ? rawSymbol.slice(dotIdx + 1) : '';
    const cleanSymbol = suffix.length >= 2 && suffix.length <= 3 ? rawSymbol.slice(0, dotIdx) : rawSymbol;
    if (FOREIGN_EXCHANGE_SUFFIXES.has(suffix.toUpperCase())) continue;
    buyPairs.push({ symbol: cleanSymbol, amount });
  }

  // ── Extract SELL markers (amount = how much to sell, not PORTFOLIO position amount) ──
  const sellSymbols = new Set<string>();
  const sellRe = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):SELL(?::\$?[\d,]+(?:\.[\d]+)?)?\]/gi;
  while ((mkMatch = sellRe.exec(response)) !== null) {
    const raw = mkMatch[0];
    if (seenMarkers.has(raw)) continue;
    seenMarkers.add(raw);
    const rawSymbol = mkMatch[1].toUpperCase();
    const dotIdx = rawSymbol.lastIndexOf('.');
    const suffix = dotIdx >= 0 ? rawSymbol.slice(dotIdx + 1) : '';
    const cleanSymbol = suffix.length >= 2 && suffix.length <= 3 ? rawSymbol.slice(0, dotIdx) : rawSymbol;
    if (FOREIGN_EXCHANGE_SUFFIXES.has(suffix.toUpperCase())) continue;
    sellSymbols.add(cleanSymbol);
  }

  // Build a lookup: symbol → set of BUY amounts
  const buyBySymbol = new Map<string, Set<number>>();
  for (const pair of buyPairs) {
    if (!buyBySymbol.has(pair.symbol)) {
      buyBySymbol.set(pair.symbol, new Set());
    }
    buyBySymbol.get(pair.symbol)!.add(pair.amount);
  }

  // ── Validate all PORTFOLIO positions against RECOMMEND markers ──
  const allPortfolioPositions = blocks.flatMap((b, bi) =>
    b.positions.map(p => ({ ...p, blockIndex: bi, strategy: b.strategy }))
  );
  for (const pos of allPortfolioPositions) {
    const sym = pos.symbol.toUpperCase();

    // Check BUY markers first (new money being deployed into this position)
    const buyAmounts = buyBySymbol.get(sym);

    // Check SELL markers (existing position being trimmed — still appears in PORTFOLIO)
    const hasSellMarker = sellSymbols.has(sym);

    if ((!buyAmounts || buyAmounts.size === 0) && !hasSellMarker) {
      return `[PORTFOLIO:...] position "${pos.symbol}" has no matching [RECOMMEND:${pos.symbol}:BUY:$${pos.amount}] or [RECOMMEND:${pos.symbol}:SELL] marker. Every portfolio position MUST have a corresponding RECOMMEND marker.`;
    }

    // Contradiction check: same symbol with both BUY and SELL markers
    if (buyAmounts && buyAmounts.size > 0 && hasSellMarker) {
      return `[PORTFOLIO:...] position "${pos.symbol}" has BOTH a BUY and SELL marker — this is contradictory. If you're trimming this position, use SELL only. The PORTFOLIO block should show the post-trim holding amount.`;
    }

    // For BUY-matched positions: strict amount check (single-block only)
    if (buyAmounts && buyAmounts.size > 0 && !isMultiBlock) {
      if (!buyAmounts.has(pos.amount)) {
        const recList = [...buyAmounts].map(a => `$${a.toLocaleString()}`).join(', ');
        return `[PORTFOLIO:...] position "${pos.symbol}" amount mismatch: PORTFOLIO says $${pos.amount.toLocaleString()} but RECOMMEND:BUY marker says ${recList}. Amounts must match exactly.`;
      }
    }

    // For SELL-matched positions: skip amount check — the SELL amount describes
    // how much to sell, and the PORTFOLIO amount is the post-trim holding.
    // These are by definition different numbers and cannot be compared.
  }

  return null; // All blocks valid
}

/**
 * Detect AI response incoherence.
 *
 * PORTFOLIO blocks are the authoritative source — if present and valid,
 * prose scanning is skipped entirely. If no PORTFOLIO blocks exist,
 * fall through to remaining prose checks (internal monologue, duplicate
 * SUMMARY_TLDR, prose questions outside CLARIFY).
 *
 * Returns a detail string if incoherence is detected, null if clean.
 */
export function detectResponseIncoherence(response: string, requestedBudget?: number | null): string | null {
  // ── PRIMARY: PORTFOLIO block validation (replaces Patterns 1-3 and 6) ──
  // If PORTFOLIO blocks are present, they are the ONLY source of truth.
  // Prose is authoritative only when no PORTFOLIO blocks exist.
  const portfolioResult = validatePortfolioBlocks(response, requestedBudget);
  const hasPortfolioBlocks = parsePortfolioBlocks(response).length > 0;
  if (hasPortfolioBlocks) {
    if (portfolioResult !== null) return portfolioResult;
    // PORTFOLIO blocks present and valid — skip all prose scanning below.
    return null;
  }

  // ── Pattern 4 (reduced): Internal monologue leaking ──
  // Only catch the most egregious phrases — PORTFOLIO blocks handle the rest.
  const internalPhrases = [
    /confirmed\s+tickers/i,
    /all\s+buttons\s+are\s+live/i,
  ];
  for (const phrase of internalPhrases) {
    if (phrase.test(response)) {
      return `Internal tool monologue leaking into user-facing text: matched "${phrase.source}". Regenerate without internal commentary.`;
    }
  }

  // ── Pattern 5: "[SUMMARY_TLDR:" appearing twice ──
  const tldrCount = (response.match(/\[SUMMARY_TLDR:/gi) || []).length;
  if (tldrCount >= 2) {
    return `Two [SUMMARY_TLDR:...] markers found — indicates two separate recommendation blocks. Regenerate one coherent response.`;
  }

  // ── Pattern 7: Prose questions outside [CLARIFY:...] blocks ──
  // The contract: every question MUST be wrapped in a [CLARIFY:{...}] block.
  // Questions in plain prose, bold text, or numbered lists outside CLARIFY blocks
  // are invisible to the UI (no chips render) and should be rejected. Same class
  // of incoherence as Pattern 6 — describes a decision point without the required
  // structured tag. Same retry cap, same graceful-failure mechanism.
  //
  // Strip all [CLARIFY:...] blocks first (bracket-counting for nested JSON),
  // then check if the remaining text contains questions.
  let strippedForClarifyCheck = '';
  let clarifyIdx = 0;
  while (clarifyIdx < response.length) {
    const clarifyStart = response.indexOf('[CLARIFY:', clarifyIdx);
    if (clarifyStart === -1) {
      strippedForClarifyCheck += response.slice(clarifyIdx);
      break;
    }
    strippedForClarifyCheck += response.slice(clarifyIdx, clarifyStart);
    // Bracket-count to find the matching ] (handle nested { and } in JSON)
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let pos = clarifyStart + 1; // skip opening [
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
    clarifyIdx = pos + 1; // skip past closing ]
  }
  // 7a: Check for question marks in the stripped text (outside CLARIFY blocks)
  // Ignore ? that appears in URLs (preceded by http or followed by =)
  const qCheckText = strippedForClarifyCheck.replace(/https?:\/\/\S+/g, ''); // strip URLs
  const qMarkMatch = qCheckText.match(/\?/);
  if (qMarkMatch) {
    // ── Trailing sign-off tolerance ──
    // If the response has valid [RECOMMEND:...] markers AND the question mark
    // appears in trailing prose (after all markers, in the last paragraph),
    // treat it as a conversational sign-off ("Ready to scale this in?") rather
    // than a missing CLARIFY block. The portfolio is complete — don't reject it.
    const hasRecommendMarkersForQ = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:(BUY|SELL)/i.test(response);
    if (hasRecommendMarkersForQ) {
      const lastMarkerIdx = response.lastIndexOf('[RECOMMEND:');
      if (lastMarkerIdx >= 0) {
        // Find the end of the last marker
        const markerEndBracket = response.indexOf(']', lastMarkerIdx);
        const afterMarkers = markerEndBracket >= 0 ? response.slice(markerEndBracket + 1) : '';
        // Check if the ONLY question mark in the response is in trailing prose
        // (after all markers, within the last sentence/paragraph)
        const qInAfterMarkers = afterMarkers.indexOf('?');
        if (qInAfterMarkers >= 0 && qInAfterMarkers < 250) {
          // Verify no question mark appears BEFORE the markers (mid-response question)
          const beforeMarkers = response.slice(0, lastMarkerIdx);
          // Strip [CLARIFY:...] blocks from beforeMarkers too
          let bmStripped = '';
          let bmIdx = 0;
          while (bmIdx < beforeMarkers.length) {
            const cs = beforeMarkers.indexOf('[CLARIFY:', bmIdx);
            if (cs === -1) { bmStripped += beforeMarkers.slice(bmIdx); break; }
            bmStripped += beforeMarkers.slice(bmIdx, cs);
            let depth = 0, inStr = false, esc = false;
            let p = cs + 1;
            for (; p < beforeMarkers.length; p++) {
              const ch = beforeMarkers[p];
              if (esc) { esc = false; continue; }
              if (ch === '\\') { esc = true; continue; }
              if (ch === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (ch === '{') { depth++; continue; }
              if (ch === '}') { if (depth > 0) depth--; continue; }
              if (ch === ']' && depth === 0) break;
            }
            bmIdx = p + 1;
          }
          const hasQBeforeMarkers = /\?/.test(bmStripped.replace(/https?:\/\/\S+/g, ''));
          if (!hasQBeforeMarkers) {
            // Only trailing sign-off — tolerate it. Caller will strip it from output.
            console.log('[chat] Tolerating trailing sign-off question (portfolio markers present)');
            return null;
          }
        }
      }
    }
    // Extract surrounding context for the error detail
    const qIdx = qMarkMatch.index!;
    const context = qCheckText.slice(Math.max(0, qIdx - 40), Math.min(qCheckText.length, qIdx + 40)).replace(/\n/g, ' ').trim();
    return `Prose question detected outside [CLARIFY:...] block: "${context}". All questions MUST use the [CLARIFY:{"question":"...","options":[...]}] format. Rewrite the question as a CLARIFY block, or if no question was intended, rephrase without the question mark.`;
  }
  // 7b: "X or Y or Z" alternative presentations without a question mark
  // The AI lists alternatives with "or" as a prose decision point — e.g.,
  // "You could deploy fresh cash, rebalance, or replace ADBE" — instead of
  // wrapping it in a structured [CLARIFY:...] block. These are invisible to
  // the UI (no chips render) and violate the one-format contract.
  const altCheckText = strippedForClarifyCheck.replace(/https?:\/\/\S+/g, '');
  // Two sub-patterns catch alternative presentations while avoiding false
  // positives on normal financial prose like "NVDA could rally or pull back":
  //   (a) Comma-separated list + "or" last item: "X, Y, or Z"
  //   (b) 2+ "or" connectors (3+ alternatives): "X or Y or Z"
  // Both require a decision-word within 250 chars. Single-"or" conditional
  // prose ("could drop 5% or 10%") is excluded — these are analysis, not
  // user-facing choice prompts.
  const altPattern = /(?:choose|pick|select|want|prefer|let me know|tell me|would you|should i|do you|could|can|may)\s.{10,250}?(?:,.{2,80},|\bor\s.{10,150}?\bor\s)/i;
  const altMatch = altCheckText.match(altPattern);
  if (altMatch) {
    const context = altMatch[0].slice(0, 120).replace(/\n/g, ' ').trim();
    return `Decision alternatives presented outside [CLARIFY:...] block: "${context}...". Use [CLARIFY:{"question":"...","options":["A","B","C"]}] format instead of listing alternatives in prose.`;
  }

  return null;
}

/**
 * Strip trailing conversational sign-off questions from a response that has
 * valid [RECOMMEND:...] markers. Haiku often appends "Ready to scale this in?",
 * "Sound good?", "Want me to adjust anything?" after a complete portfolio.
 * These are harmless conversational noise — don't reject the portfolio over it.
 */
export function stripTrailingQuestions(text: string): string {
  // Only strip if there are RECOMMEND markers (portfolio response)
  if (!/\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:(BUY|SELL)/i.test(text)) return text;

  // Find the last RECOMMEND marker position
  const lastMarkerIdx = text.lastIndexOf('[RECOMMEND:');
  if (lastMarkerIdx < 0) return text;
  const markerEndBracket = text.indexOf(']', lastMarkerIdx);
  if (markerEndBracket < 0) return text;

  const afterMarkers = text.slice(markerEndBracket + 1);
  const qIdx = afterMarkers.indexOf('?');
  if (qIdx < 0 || qIdx > 300) return text; // No question or too far from markers

  // Find the start of the sentence containing the question mark
  const beforeQ = afterMarkers.slice(0, qIdx);
  // Walk back to find sentence start (period+space, newline, or start of after-markers)
  let sentenceStart = 0;
  for (let i = beforeQ.length - 1; i >= 0; i--) {
    if (beforeQ[i] === '\n') { sentenceStart = i + 1; break; }
    if (beforeQ[i] === '.' && (i + 1 >= beforeQ.length || beforeQ[i + 1] === ' ')) {
      sentenceStart = i + 1;
      break;
    }
  }

  // Find the end of the question (next newline or end of text)
  let questionEnd = afterMarkers.indexOf('\n', qIdx);
  if (questionEnd < 0) questionEnd = afterMarkers.length;
  // Include trailing newline if present
  if (questionEnd < afterMarkers.length && afterMarkers[questionEnd] === '\n') questionEnd++;

  // Build cleaned text: everything before the trailing question sentence
  const before = text.slice(0, markerEndBracket + 1);
  const afterBeforeQ = afterMarkers.slice(0, sentenceStart);
  const afterQ = afterMarkers.slice(questionEnd);

  const cleaned = before + afterBeforeQ + afterQ;
  // Clean up double newlines and trailing whitespace
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}
