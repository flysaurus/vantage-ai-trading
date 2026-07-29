'use client';

// ─── ClarifyingOptions — Tappable chip UI for AI clarifying questions ───
// When the AI asks a question with 2-4 discrete options, this component
// extracts them and renders frosted-glass pill chips the user can tap to
// reply instantly — no typing required.

import { useState, useCallback } from 'react';

export interface ClarifyingOption {
  /** Short button label (3-30 chars, e.g. "Value", "Deploy $2K fresh") */
  label: string;
  /** Full option text sent as user reply */
  fullText: string;
  /** Position in the original content for ordering */
  index: number;
}

// ── Patterns for detecting clarifying questions ──────────────

// Bold list items:  - **Label** — description  or  1. **Label** — description
const BOLD_LIST_ITEM_RE = /^[\s]*(?:[-*•]|\d{1,2}\.)\s+\*\*(.+?)\*\*(?:\s*[—\-–:]\s*(.+))?$/gm;

// Plain list items (no bold):  - Label text here  or  1. Label text here
const PLAIN_LIST_ITEM_RE = /^[\s]*(?:[-*•]|\d{1,2}\.)\s+(?!\*\*)([^\n]{4,80})$/gm;

// Standalone bold lines: each line is just **Label**
const BOLD_LINE_RE = /^[\s]*\*\*(.+?)\*\*[\s]*$/gm;

// Question indicators: surrounding text should suggest a clarifying question
const QUESTION_HINTS = [
  /\?/,
  /\b(?:which|choose|prefer|pick|select|decide|option|approach|split|weight|direction|allocation)\b/i,
  /\bwould you like\b/i,
  /\bwant me to\b/i,
  /\blet me know\b/i,
  /\bhow (?:would|should|do) you\b/i,
  /\bwhat (?:would|do) you\b/i,
  /\bdo you want\b/i,
  /\bhere are\b/i,
  /\byou want\b/i,
];

// ── Shape 2: CONFIRM-OR-ADJUST detection ──────────────
// AI proposes a framework/plan then asks for confirmation or adjustment.
// Renders as "Looks good ✓" + "Let me adjust ✎" chips.

const CONFIRM_ADJUST_PATTERNS = [
  /\b(?:framework|plan|approach|strategy|setup|split|allocation)\s+(?:work|look|sound)(?:s)?\b/i,
  /\b(?:want|need|like)\s+(?:me to|to)\s+(?:adjust|change|tweak|modify|revise)\b/i,
  /\b(?:let me know|tell me)\s+(?:if|what|how)\b.*\b(?:adjust|change|tweak|want)\b/i,
  /\b(?:does|do)\s+(?:this|that|it)\s+(?:work|look|sound|feel)\b/i,
  /\b(?:confirm|lock|finalize)\s+(?:before|and|then|criteri)/i,
  /\b(?:before|once)\s+(?:i|we|you)\s+(?:screen|build|run|go)\b/i,
  /\bgo\s+(?:ahead|with)\b/i,
];

/**
 * Check if the response contains a confirm-or-adjust pattern:
 * AI proposed a framework AND asks "does this work / should I tweak?"
 * Returns true if the response is a framework proposal asking for confirmation.
 */
function detectConfirmOrAdjust(markdownContent: string): boolean {
  // Guard: very short responses aren't framework proposals
  if (markdownContent.length < 100) return false;

  // Must have a question mark (asking for confirmation)
  if (!markdownContent.includes('?')) return false;

  // Must match at least one confirm-adjust pattern
  const hasPattern = CONFIRM_ADJUST_PATTERNS.some(p => p.test(markdownContent));

  // Must have substantive framework content (bullet items, specific metrics, P/E bands, etc.)
  const hasFrameworkContent = /\b(?:P\/E|EPS|growth|margin|drawdown|position|allocation|caps?)\b/i.test(markdownContent);

  console.log('[ClarifyingOptions] Confirm-adjust check: pattern=' + hasPattern + ' framework=' + hasFrameworkContent);

  return hasPattern && hasFrameworkContent;
}

// ── Shape 1: CLOSED OPTIONS — scan for "or"-separated choices ──
// Finds the last question sentence containing " or " and extracts
// discrete named options (e.g. "50/50 split, or lean heavier?")
// rather than blindly splitting the whole response.

function extractOrOptions(text: string): string[] | null {
  // Strategy: find each "?", then look BACKWARD up to 150 chars for " or ".
  // This catches the actual closing question ("50/50 or lean heavier?")
  // while ignoring incidental "or" in prose far from any question mark.
  const qPositions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '?') qPositions.push(i);
  }
  if (qPositions.length === 0) return null;

  // Work backward through question marks
  for (let qi = qPositions.length - 1; qi >= 0; qi--) {
    const qPos = qPositions[qi];
    // Look at the text 150 chars before this ? (or start of text)
    const lookStart = Math.max(0, qPos - 150);
    const window = text.slice(lookStart, qPos);

    // Find the last " or " in this window
    const orIdx = window.lastIndexOf(' or ');
    if (orIdx === -1) continue;

    // Extract from after the " or " separator backward to find the options
    // We want the text around this " or ", starting from the previous sentence break
    const fullWindow = text.slice(lookStart, qPos);
    
    // Find the rightmost sentence-start within our window (capital letter after [.!?])
    // or fall back to the lookStart
    const sentenceBreaks = [...fullWindow.matchAll(/(?<=[.!?])\s+(?=[A-Z])/g)];
    let sentenceStart = lookStart;
    if (sentenceBreaks.length > 0) {
      const lastBreak = sentenceBreaks[sentenceBreaks.length - 1];
      sentenceStart = lookStart + (lastBreak.index || 0) + lastBreak[0].length;
    }

    // Also try to find a dash/colon separator AFTER the sentence start
    let target = text.slice(sentenceStart, qPos);
    const sepIdx = Math.max(
      target.lastIndexOf('—'), target.lastIndexOf('–'),
      target.lastIndexOf(': ')
    );
    if (sepIdx > 5) target = target.slice(sepIdx + 1);

    // Clean up
    target = target.replace(/^(how|what|which|would you|do you|should i|can you|want to|could you|let me know)\s+/i, '').trim();
    target = target.replace(/[?.!]+$/, '').trim();

    if (!target.includes(' or ')) continue;

    // Split on " or "
    const parts = target.split(/\s+or\s+/i);
    if (parts.length < 2) continue;

    const candidates: string[] = [];
    for (const p of parts) {
      let opt = p.trim().replace(/[,]+$/, '').trim();
      const subParts = opt.split(/\s*,\s*/).filter(s => s.length >= 3);
      for (const sp of subParts) {
        if (sp.length >= 3 && sp.length <= 80) candidates.push(sp);
      }
    }

    if (candidates.length >= 2 && candidates.length <= 4) {
      // Gate: reject if candidates look like confirm-or-adjust framing instead
      // of discrete named choices (e.g. "should I adjust?" vs "50/50 split")
      const looksLikeConfirmAdjust = candidates.some(c =>
        /^(?:do(?:es)?|should|would|can|could|want|need|let)\s/i.test(c) ||
        /\b(?:work|look|sound|adjust|change|tweak|modify|revise|go ahead)\b/i.test(c) && c.length > 30
      );
      if (!looksLikeConfirmAdjust) return candidates;
      console.log('[ClarifyingOptions] Tier 4 candidates look like confirm/adjust framing — skipping to Tier 5');
    }
  }

  return null;
}

/**
 * Parse an AI markdown response to detect clarifying questions with
 * 2-4 discrete options the user can tap to reply.
 *
 * Multi-tier detection:
 * 1. Bold list items (highest confidence — the AI was explicit)
 * 2. Plain text list items + question context
 * 3. Standalone bold lines + question context
 * 4. Inline "or"-separated options in the closing question sentence
 * 5. CONFIRM-OR-ADJUST: proposed framework + confirmation question
 *
 * Returns null if no valid clarifying question is detected.
 */
export function parseClarifyingOptions(markdownContent: string): ClarifyingOption[] | null {
  if (!markdownContent || markdownContent.length < 15) return null;

  let options: { label: string; fullText: string; index: number }[] = [];
  let idx = 0;

  // ── Tier 1: Bold list items (highest confidence) ──
  BOLD_LIST_ITEM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOLD_LIST_ITEM_RE.exec(markdownContent)) !== null) {
    const label = match[1].trim();
    const description = match[2]?.trim() || '';
    const fullText = description ? `${label} — ${description}` : label;
    if (label.length >= 3) {
      options.push({ label, fullText, index: idx });
    }
    idx++;
  }

  // ── Tier 2: Plain text list items (fallback) ──
  if (options.length === 0) {
    PLAIN_LIST_ITEM_RE.lastIndex = 0;
    idx = 0;
    while ((match = PLAIN_LIST_ITEM_RE.exec(markdownContent)) !== null) {
      const label = match[1].trim();
      if (label.length >= 3 && !label.startsWith('`') && !label.startsWith('[')) {
        options.push({ label, fullText: label, index: idx });
      }
      idx++;
    }
  }

  // ── Tier 3: Standalone bold lines ──
  if (options.length === 0) {
    BOLD_LINE_RE.lastIndex = 0;
    idx = 0;
    while ((match = BOLD_LINE_RE.exec(markdownContent)) !== null) {
      const label = match[1].trim();
      if (label.length >= 3) {
        options.push({ label, fullText: label, index: idx });
      }
      idx++;
    }
  }

  // ── Tier 4: Inline "or"-separated CLOSED OPTIONS ──
  if (options.length === 0) {
    const orCandidates = extractOrOptions(markdownContent);
    if (orCandidates) {
      options = orCandidates.map((c, i) => ({ label: c, fullText: c, index: i }));
      console.log('[ClarifyingOptions] Tier 4 (or-options) detected:', options.map(o => o.label));
    }
  }

  // ── Tier 5: CONFIRM-OR-ADJUST (proposed framework + confirmation) ──
  if (options.length === 0) {
    if (detectConfirmOrAdjust(markdownContent)) {
      options = [
        { label: 'Looks good ✓', fullText: 'Looks good — go ahead with this.', index: 0 },
        { label: 'Let me adjust ✎', fullText: 'Let me adjust:', index: 1 },
      ];
      console.log('[ClarifyingOptions] Tier 5 (confirm-or-adjust) detected');
    }
  }

  // Need 2-4 discrete options
  if (options.length < 2 || options.length > 4) {
    if (options.length > 0 && typeof window !== 'undefined') {
      console.log('[ClarifyingOptions] Found', options.length, 'items — need 2-4, skipping');
    }
    return null;
  }

  // ── Validate question context (skip for Tier 4/5 which already validated) ──
  if (options.length > 0 && options[0].fullText !== 'Looks good — go ahead with this.') {
    let surrounding = markdownContent
      .replace(BOLD_LIST_ITEM_RE, '')
      .replace(PLAIN_LIST_ITEM_RE, '')
      .replace(BOLD_LINE_RE, '');
    BOLD_LIST_ITEM_RE.lastIndex = 0;
    PLAIN_LIST_ITEM_RE.lastIndex = 0;
    BOLD_LINE_RE.lastIndex = 0;
    surrounding = surrounding
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\[RECOMMEND[^\]]*\]/g, '');

    const isShortResponse = markdownContent.length < 400;
    const hasQuestionContext = QUESTION_HINTS.some(p => p.test(surrounding));

    if (!hasQuestionContext && !isShortResponse) {
      if (typeof window !== 'undefined') {
        console.log('[ClarifyingOptions] Found', options.length, 'options but no question context');
      }
      return null;
    }
  }

  console.log('[ClarifyingOptions] ✅ Detected', options.length, 'options:', options.map(o => o.label));
  return options;
}

/**
 * Derive a compact button label from the full option text.
 */
function shortenLabel(label: string): string {
  if (label.length <= 30) return label;

  // Pattern: "Verb $Amount …" → "Verb $Amount"
  const moneyMatch = label.match(/^(.+?\$[\d,.]+[KMB]?)\b.*$/);
  if (moneyMatch && moneyMatch[1].length <= 25) return moneyMatch[1];

  // Pattern: "Verb your Noun …" → "Verb your Noun"
  const yourMatch = label.match(/^(.+?your\s+\w+).*$/i);
  if (yourMatch && yourMatch[1].length <= 30) return yourMatch[1];

  // Fallback: word-boundary truncation
  const maxLen = 32;
  const cut = label.lastIndexOf(' ', maxLen - 3);
  if (cut > 10) return label.slice(0, cut) + '…';
  return label.slice(0, maxLen - 3) + '…';
}

// ── Component ────────────────────────────────────────────────

interface ClarifyingOptionsProps {
  options: ClarifyingOption[];
  onSelect: (option: ClarifyingOption) => void;
}

export function ClarifyingOptions({ options, onSelect }: ClarifyingOptionsProps) {
  const [tapped, setTapped] = useState<number | null>(null);

  const handleTap = useCallback((opt: ClarifyingOption, i: number) => {
    setTapped(i);
    setTimeout(() => {
      onSelect(opt);
      setTapped(null);
    }, 250);
  }, [onSelect]);

  // Check if the "Let me adjust" chip was tapped (opens free-text, not preset)
  const isAdjustChip = (label: string) => label === 'Let me adjust ✎';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      marginTop: '2px',
      marginBottom: '4px',
      alignSelf: 'flex-start',
      maxWidth: '92%',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {options.map((opt, i) => {
          const isTapped = tapped === i;
          const isAdjust = isAdjustChip(opt.label);
          return (
            <button
              key={i}
              onClick={() => handleTap(opt, i)}
              disabled={tapped !== null}
              style={{
                background: isTapped
                  ? 'rgba(34,211,238,0.15)'
                  : isAdjust
                    ? 'rgba(250,204,21,0.06)'
                    : 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: isTapped
                  ? '1px solid rgba(34,211,238,0.4)'
                  : isAdjust
                    ? '1px solid rgba(250,204,21,0.25)'
                    : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '20px',
                padding: '7px 16px',
                cursor: tapped !== null ? 'default' : 'pointer',
                color: isTapped
                  ? '#22d3ee'
                  : isAdjust
                    ? 'rgba(250,204,21,0.9)'
                    : 'rgba(255,255,255,0.85)',
                fontFamily: 'var(--font-sans, inherit)',
                fontSize: '12.5px',
                fontWeight: 500,
                lineHeight: '1.4',
                textAlign: 'left',
                transition: 'all 0.2s ease',
                maxWidth: '100%',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                opacity: isTapped ? 0.7 : 1,
                transform: isTapped ? 'scale(0.97)' : 'scale(1)',
              }}
              onMouseEnter={(e) => {
                if (tapped !== null) return;
                (e.currentTarget as HTMLElement).style.background = isAdjust
                  ? 'rgba(250,204,21,0.1)'
                  : 'rgba(34,211,238,0.08)';
                (e.currentTarget as HTMLElement).style.borderColor = isAdjust
                  ? 'rgba(250,204,21,0.35)'
                  : 'rgba(34,211,238,0.3)';
              }}
              onMouseLeave={(e) => {
                if (tapped !== null) return;
                (e.currentTarget as HTMLElement).style.background = isAdjust
                  ? 'rgba(250,204,21,0.06)'
                  : 'rgba(255,255,255,0.04)';
                (e.currentTarget as HTMLElement).style.borderColor = isAdjust
                  ? 'rgba(250,204,21,0.25)'
                  : 'rgba(255,255,255,0.1)';
              }}
            >
              {isAdjust ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {shortenLabel(opt.label).replace(' ✎', '')}
                  <span style={{ fontSize: '10px', opacity: 0.6 }}>✎</span>
                </span>
              ) : (
                shortenLabel(opt.label)
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
