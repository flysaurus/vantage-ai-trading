'use client';

// ─── ClarifyingOptions — Tappable chip UI for AI clarifying questions ───
// Two modes:
// 1. Single-question: all chips rendered at once (existing behavior)
// 2. ClarifyStepper: sequential one-at-a-time for multi-question messages

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
  const seen = new Set<string>();

  CLARIFY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CLARIFY_PATTERN.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const question = parsed.question;
      if (!question || typeof question !== 'string' || question.trim().length < 2) continue;

      const key = question.trim() + '|' + JSON.stringify(parsed.options);
      if (seen.has(key)) continue;
      seen.add(key);

      const options = Array.isArray(parsed.options) && parsed.options.length > 0
        ? parsed.options.filter((o: unknown) => typeof o === 'string' && o.trim().length > 0)
        : null;

      results.push({ question: question.trim(), options });
    } catch {
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
 */
export function stripClarifyMarkers(text: string): string {
  return text
    .replace(CLARIFY_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert ClarifyingQuestion[] to the chip-compatible ClarifyingOption[] format.
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
 */
export function buildClarifyText(questions: ClarifyingQuestion[]): string {
  if (questions.length === 0) return '';
  return questions.map(q => q.question).join('\n\n');
}

/**
 * Legacy wrapper — kept for backward compatibility during transition.
 */
export function parseClarifyingOptions(markdownContent: string): ClarifyingOption[] | null {
  const questions = parseClarifyMarkers(markdownContent);
  const options = questionsToOptions(questions);
  if (options.length < 2 || options.length > 8) return null;
  return options;
}

// ── Chip renderer (shared by single-question and stepper) ───

const CHIP_STYLE: React.CSSProperties = {
  background: 'rgba(34,211,238,0.06)',
  border: '1px solid rgba(34,211,238,0.2)',
  borderRadius: '10px',
  padding: '10px 18px',
  cursor: 'pointer',
  color: '#ffffff',
  fontFamily: 'var(--font-sans, inherit)',
  fontSize: '13.5px',
  fontWeight: 600,
  lineHeight: '1.4',
  textAlign: 'left' as const,
  transition: 'all 0.15s ease',
  whiteSpace: 'normal' as const,
  wordBreak: 'break-word' as const,
  opacity: 1,
  letterSpacing: '0.01em',
  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
};

const CHIP_TAPPED_STYLE: React.CSSProperties = {
  background: 'rgba(34,211,238,0.2)',
  borderColor: 'rgba(34,211,238,0.6)',
  color: '#22d3ee',
  transform: 'scale(0.97)',
  boxShadow: '0 1px 4px rgba(34,211,238,0.25)',
};

interface ChipRowProps {
  options: ClarifyingOption[];
  onSelect: (option: ClarifyingOption) => void;
}

function ChipRow({ options, onSelect }: ChipRowProps) {
  const [tapped, setTapped] = useState<number | null>(null);

  const handleTap = useCallback((opt: ClarifyingOption, i: number) => {
    setTapped(i);
    setTimeout(() => {
      onSelect(opt);
      setTapped(null);
    }, 200);
  }, [onSelect]);

  const isAdjustChip = (label: string) =>
    label === 'Let me adjust ✎' || label === 'Let me adjust something';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {options.map((opt, i) => {
        const isTapped = tapped === i;
        const isAdjust = isAdjustChip(opt.label);
        return (
          <button
            key={i}
            onClick={() => handleTap(opt, i)}
            disabled={tapped !== null}
            style={{
              ...CHIP_STYLE,
              ...(isTapped
                ? CHIP_TAPPED_STYLE
                : {}),
              ...((isAdjust && !isTapped)
                ? {
                    background: 'rgba(250,204,21,0.06)',
                    borderColor: 'rgba(250,204,21,0.25)',
                    color: 'rgba(250,204,21,0.9)',
                  }
                : {}),
              cursor: tapped !== null ? 'default' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (tapped !== null) return;
              const t = e.currentTarget;
              t.style.background = isAdjust ? 'rgba(250,204,21,0.12)' : 'rgba(34,211,238,0.14)';
              t.style.borderColor = isAdjust ? 'rgba(250,204,21,0.4)' : 'rgba(34,211,238,0.45)';
              t.style.boxShadow = '0 2px 8px rgba(34,211,238,0.15)';
              t.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              if (tapped !== null) return;
              const t = e.currentTarget;
              t.style.background = isAdjust ? 'rgba(250,204,21,0.06)' : CHIP_STYLE.background as string;
              t.style.borderColor = isAdjust ? 'rgba(250,204,21,0.25)' : (CHIP_STYLE.borderColor as string);
              t.style.boxShadow = (CHIP_STYLE.boxShadow as string) || 'none';
              t.style.transform = 'translateY(0)';
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Single-question mode (existing behavior) ─────────────────

interface ClarifyingOptionsProps {
  options: ClarifyingOption[];
  onSelect: (option: ClarifyingOption) => void;
}

export function ClarifyingOptions({ options, onSelect }: ClarifyingOptionsProps) {
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
      <ChipRow options={options} onSelect={onSelect} />
    </div>
  );
}

// ── Sequential stepper (multi-question mode) ─────────────────

export interface ClarifyStepperProps {
  /** Queue of questions (parsed from [CLARIFY:...] markers) */
  questions: ClarifyingQuestion[];
  /** Current step index (0-based) */
  step: number;
  /** Called when a chip is tapped — parent advances step */
  onChipTap: (answer: string) => void;
}

export function ClarifyStepper({ questions, step, onChipTap }: ClarifyStepperProps) {
  if (step >= questions.length) return null;

  const currentQ = questions[step];
  const total = questions.length;
  const isMulti = total > 1;

  // Build chip options for current question only
  const currentOptions: ClarifyingOption[] = [];
  if (currentQ.options && currentQ.options.length > 0) {
    currentQ.options.forEach((label, i) => {
      currentOptions.push({ label, fullText: label, questionIndex: 0 });
    });
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      marginTop: '6px',
      marginBottom: '6px',
      alignSelf: 'flex-start',
      maxWidth: '92%',
      background: 'rgba(34,211,238,0.03)',
      border: '1px solid rgba(34,211,238,0.12)',
      borderRadius: '12px',
      padding: '14px 16px',
    }}>
      {/* Step indicator */}
      {isMulti && (
        <div style={{
          fontSize: '10.5px',
          fontWeight: 700,
          color: 'rgba(34,211,238,0.8)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          background: 'rgba(34,211,238,0.08)',
          borderRadius: '4px',
          padding: '2px 8px',
          display: 'inline-block',
          alignSelf: 'flex-start',
        }}>
          Step {step + 1} of {total}
        </div>
      )}

      {/* Question text — prominent, easy to scan */}
      <div style={{
        fontSize: '14.5px',
        color: '#ffffff',
        lineHeight: '1.5',
        fontWeight: 700,
      }}>
        {currentQ.question}
      </div>

      {/* Chips for current question, or free-text hint */}
      {currentOptions.length > 0 ? (
        <ChipRow
          options={currentOptions}
          onSelect={(opt) => onChipTap(opt.fullText)}
        />
      ) : (
        <div style={{
          fontSize: '11.5px',
          color: 'rgba(255,255,255,0.35)',
          fontStyle: 'italic',
          padding: '4px 0',
        }}>
          Type your answer below…
        </div>
      )}
    </div>
  );
}
