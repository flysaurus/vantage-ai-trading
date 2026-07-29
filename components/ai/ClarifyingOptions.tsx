'use client';

// ─── ClarifyingOptions — Tappable chip UI for AI clarifying questions ───
// When the AI includes [CLARIFY:{...}] markers in its response, this
// component extracts them and renders frosted-glass pill chips the user
// can tap to reply instantly — no typing required.

import { useState, useCallback } from 'react';

export interface ClarifyingOption {
  /** Short button label (3-30 chars) */
  label: string;
  /** Full option text sent as user reply */
  fullText: string;
  /** Which question this belongs to (for multi-question messages) */
  questionIndex: number;
}

export interface ClarifyingQuestion {
  /** The question text rendered in the bubble */
  question: string;
  /** Optional list of tappable options; empty/null = free-text only */
  options: string[] | null;
}

// ── Structured [CLARIFY:...] marker extraction ──────────────

const CLARIFY_PATTERN = /\[CLARIFY:\s*(\{.+?\})\]/g;

/**
 * Strict extraction of [CLARIFY:{...}] markers only.
 * No prose inference, no regex guessing — exact format or ignore.
 * Same discipline as the RECOMMEND marker parser.
 */
export function parseClarifyMarkers(content: string): ClarifyingQuestion[] {
  if (!content || content.length < 10) return [];

  const results: ClarifyingQuestion[] = [];
  const seen = new Set<string>(); // deduplicate identical markers

  // Reset regex state
  CLARIFY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CLARIFY_PATTERN.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const question = parsed.question;
      if (!question || typeof question !== 'string' || question.trim().length < 2) continue;

      // Deduplicate
      const key = question.trim() + '|' + JSON.stringify(parsed.options);
      if (seen.has(key)) continue;
      seen.add(key);

      const options = Array.isArray(parsed.options) && parsed.options.length > 0
        ? parsed.options.filter((o: unknown) => typeof o === 'string' && o.trim().length > 0)
        : null;

      results.push({ question: question.trim(), options });
    } catch {
      // Malformed JSON — skip, don't crash
      console.log('[ClarifyingOptions] Skipped malformed CLARIFY marker');
    }
  }

  if (results.length > 0 && typeof window !== 'undefined') {
    console.log('[ClarifyingOptions] ✅ Parsed', results.length, 'CLARIFY markers:', results.map(q => q.question));
  }

  return results;
}

/**
 * Strip [CLARIFY:{...}] markers from display text.
 * The marker itself is invisible — only the question text within gets rendered.
 */
export function stripClarifyMarkers(text: string): string {
  return text
    .replace(CLARIFY_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')  // collapse excessive blank lines
    .trim();
}

/**
 * Convert ClarifyingQuestion[] to the chip-compatible ClarifyingOption[] format
 * used by the render component.
 */
export function questionsToOptions(questions: ClarifyingQuestion[]): ClarifyingOption[] {
  const options: ClarifyingOption[] = [];
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi];
    const opts = q.options;
    if (opts && opts.length >= 2 && opts.length <= 4) {
      for (const optLabel of opts) {
        options.push({
          label: optLabel,
          fullText: optLabel,
          questionIndex: qi,
        });
      }
    }
  }
  return options;
}

/**
 * Build the rendered clarifying text from parsed markers.
 * Each question text is displayed in the bubble above its chips.
 */
export function buildClarifyText(questions: ClarifyingQuestion[]): string {
  if (questions.length === 0) return '';
  return questions.map(q => q.question).join('\n\n');
}

/**
 * Legacy wrapper — kept for backward compatibility during transition.
 * Prefer parseClarifyMarkers + questionsToOptions for new code.
 */
export function parseClarifyingOptions(markdownContent: string): ClarifyingOption[] | null {
  const questions = parseClarifyMarkers(markdownContent);
  const options = questionsToOptions(questions);
  if (options.length < 2 || options.length > 8) return null;
  return options;
}

// ── Rendering ───────────────────────────────────────────────

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
  const isAdjustChip = (label: string) =>
    label === 'Let me adjust ✎' || label === 'Let me adjust something';

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
