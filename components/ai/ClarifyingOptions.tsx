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
  /\b(?:which|choose|prefer|pick|select|decide|option|approach)\b/i,
  /\bwould you like\b/i,
  /\bwant me to\b/i,
  /\blet me know\b/i,
  /\bhow (?:would|should|do) you\b/i,
  /\bwhat (?:would|do) you\b/i,
  /\bdo you want\b/i,
  /\bhere are\b/i,
];

/**
 * Parse an AI markdown response to detect clarifying questions with
 * 2-4 discrete options the user can tap to reply.
 *
 * Multi-tier detection:
 * 1. Bold list items (highest confidence — the AI was explicit)
 * 2. Plain text list items + question context
 * 3. Standalone bold lines + question context
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
      // Filter out sub-bullets, code blocks, and markdown syntax
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

  // Need 2-4 discrete options
  if (options.length < 2 || options.length > 4) {
    if (options.length > 0 && typeof window !== 'undefined') {
      console.log('[ClarifyingOptions] Found', options.length, 'items — need 2-4, skipping');
    }
    return null;
  }

  // ── Validate question context ──
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

  // Lenient: if response is SHORT and mostly consists of the list items,
  // treat it as a clarifying question even without explicit question words.
  // (The AI was told to be terse for clarifying questions.)
  const isShortResponse = markdownContent.length < 400;
  const hasQuestionContext = QUESTION_HINTS.some(p => p.test(surrounding));

  if (!hasQuestionContext && !isShortResponse) {
    if (typeof window !== 'undefined') {
      console.log('[ClarifyingOptions] Found', options.length, 'options but no question context');
    }
    return null;
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
          return (
            <button
              key={i}
              onClick={() => handleTap(opt, i)}
              disabled={tapped !== null}
              style={{
                background: isTapped
                  ? 'rgba(34,211,238,0.15)'
                  : 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: isTapped
                  ? '1px solid rgba(34,211,238,0.4)'
                  : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '20px',
                padding: '7px 16px',
                cursor: tapped !== null ? 'default' : 'pointer',
                color: isTapped ? '#22d3ee' : 'rgba(255,255,255,0.85)',
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
                (e.currentTarget as HTMLElement).style.background = 'rgba(34,211,238,0.08)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,211,238,0.3)';
              }}
              onMouseLeave={(e) => {
                if (tapped !== null) return;
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              {shortenLabel(opt.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
