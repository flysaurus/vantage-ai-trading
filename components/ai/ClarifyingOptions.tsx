'use client';

// ─── ClarifyingOptions — Tappable chip UI for AI clarifying questions ───
// When the AI asks a question with 2-4 discrete options (rendered as bold
// list items), this component extracts them and renders frosted-glass chips
// that the user can tap to reply instantly — no typing required.

import { useState, useCallback } from 'react';

export interface ClarifyingOption {
  /** Short button label (bold text minus description) */
  label: string;
  /** Full option text sent as user reply */
  fullText: string;
  /** Position in the original content for ordering */
  index: number;
}

// ── Patterns for detecting clarifying questions ──────────────

// Bold list items:  - **Label** — description  or  1. **Label** — description
// Captures the bold text (label) and optional description after — or :
const BOLD_LIST_ITEM_RE = /^[\s]*(?:[-*•]|\d{1,2}\.)\s+\*\*(.+?)\*\*(?:\s*[—\-–:]\s*(.+))?$/gm;

// Standalone bold lines (no list marker): each line is just **Label**
// Used when the model outputs bold options without bullet markers
const BOLD_LINE_RE = /^[\s]*\*\*(.+?)\*\*[\s]*$/gm;

// Question indicators: the surrounding text should suggest a clarifying question
const QUESTION_HINTS = [
  /\?/,                          // literal question mark
  /\b(?:which|choose|prefer|pick|select|decide)\b/i,
  /\bwould you like\b/i,
  /\bwant me to\b/i,
  /\blet me know\b/i,
  /\bhow would you\b/i,
  /\bwhat would you\b/i,
  /\bdo you want\b/i,
];

/**
 * Parse an AI markdown response to detect clarifying questions with
 * 2-4 discrete bold-list options the user can tap to reply.
 *
 * Returns null if no valid clarifying question is detected.
 */
export function parseClarifyingOptions(markdownContent: string): ClarifyingOption[] | null {
  if (!markdownContent || markdownContent.length < 20) return null;

  // Step 1: Extract bold list items
  BOLD_LIST_ITEM_RE.lastIndex = 0;
  const options: { label: string; fullText: string; index: number }[] = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = BOLD_LIST_ITEM_RE.exec(markdownContent)) !== null) {
    const label = match[1].trim();
    const description = match[2]?.trim() || '';
    const fullText = description ? `${label} — ${description}` : label;
    // Only accept labels that are 6+ chars (skip single-word placeholders)
    if (label.length >= 6) {
      options.push({ label, fullText, index: idx });
    }
    idx++;
  }

  // Step 1b: If no bold list items found, try standalone bold lines
  if (options.length === 0) {
    BOLD_LINE_RE.lastIndex = 0;
    idx = 0;
    while ((match = BOLD_LINE_RE.exec(markdownContent)) !== null) {
      const label = match[1].trim();
      if (label.length >= 6) {
        options.push({ label, fullText: label, index: idx });
      }
      idx++;
    }
  }

  // Need 2-4 discrete options
  if (options.length < 2 || options.length > 4) return null;

  // Step 2: Check if the surrounding context is a clarifying question
  // Remove the matched list items to check the remaining text for question hints
  let surrounding = markdownContent.replace(BOLD_LIST_ITEM_RE, '');
  BOLD_LIST_ITEM_RE.lastIndex = 0; // reset after replace
  surrounding = surrounding.replace(BOLD_LINE_RE, '');
  BOLD_LINE_RE.lastIndex = 0;

  // Also strip other markdownisms that might interfere
  surrounding = surrounding.replace(/\*\*(.+?)\*\*/g, '$1'); // strip remaining bold
  surrounding = surrounding.replace(/\[RECOMMEND[^\]]*\]/g, ''); // strip recommendation markers

  const hasQuestionContext = QUESTION_HINTS.some(pattern => pattern.test(surrounding));
  if (!hasQuestionContext) return null;

  return options;
}

/**
 * Shorten a label for button display.
 * Keeps it under ~35 chars, cutting at word boundaries.
 */
function shortenLabel(label: string, maxLen = 35): string {
  if (label.length <= maxLen) return label;
  const cut = label.lastIndexOf(' ', maxLen - 3);
  if (cut > 10) return label.slice(0, cut) + '…';
  return label.slice(0, maxLen - 3) + '…';
}

// ── Component ────────────────────────────────────────────────

interface ClarifyingOptionsProps {
  options: ClarifyingOption[];
  /** Called when the user taps an option — sends the full text as reply */
  onSelect: (option: ClarifyingOption) => void;
}

export function ClarifyingOptions({ options, onSelect }: ClarifyingOptionsProps) {
  const [tapped, setTapped] = useState<number | null>(null);

  const handleTap = useCallback((opt: ClarifyingOption, i: number) => {
    setTapped(i);
    // Brief visual feedback then send
    setTimeout(() => {
      onSelect(opt);
      setTapped(null);
    }, 250);
  }, [onSelect]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginTop: '10px',
        paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Small caption */}
      <div style={{
        fontSize: '10px',
        fontWeight: 600,
        color: 'rgba(255,255,255,0.35)',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        marginBottom: '2px',
      }}>
        Tap to reply
      </div>

      {/* Option chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {options.map((opt, i) => {
          const isTapped = tapped === i;
          return (
            <button
              key={i}
              onClick={() => handleTap(opt, i)}
              disabled={tapped !== null}
              style={{
                // Frosted-glass base
                background: isTapped
                  ? 'rgba(34,211,238,0.15)'
                  : 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: isTapped
                  ? '1px solid rgba(34,211,238,0.4)'
                  : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '8px 14px',
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
                e.currentTarget.style.background = 'rgba(34,211,238,0.08)';
                e.currentTarget.style.borderColor = 'rgba(34,211,238,0.3)';
              }}
              onMouseLeave={(e) => {
                if (tapped !== null) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              {shortenLabel(opt.label)}
            </button>
          );
        })}
      </div>

      {/* Subtle hint */}
      <div style={{
        fontSize: '10px',
        color: 'rgba(255,255,255,0.25)',
        marginTop: '2px',
        fontStyle: 'italic',
      }}>
        or type your own reply below
      </div>
    </div>
  );
}
