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
  background: 'rgba(255,255,255,0.04)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '20px',
  padding: '7px 16px',
  cursor: 'pointer',
  color: 'rgba(255,255,255,0.85)',
  fontFamily: 'var(--font-sans, inherit)',
  fontSize: '12.5px',
  fontWeight: 500,
  lineHeight: '1.4',
  textAlign: 'left' as const,
  transition: 'all 0.2s ease',
  whiteSpace: 'normal' as const,
  wordBreak: 'break-word' as const,
  opacity: 1,
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
              ...CHIP_STYLE,
              background: isTapped
                ? 'rgba(34,211,238,0.15)'
                : isAdjust ? 'rgba(250,204,21,0.06)' : CHIP_STYLE.background,
              borderColor: isTapped
                ? 'rgba(34,211,238,0.4)'
                : isAdjust ? 'rgba(250,204,21,0.25)' : 'rgba(255,255,255,0.1)',
              color: isTapped
                ? '#22d3ee'
                : isAdjust ? 'rgba(250,204,21,0.9)' : 'rgba(255,255,255,0.85)',
              cursor: tapped !== null ? 'default' : 'pointer',
              opacity: isTapped ? 0.7 : 1,
              transform: isTapped ? 'scale(0.97)' : 'scale(1)',
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
      gap: '8px',
      marginTop: '4px',
      marginBottom: '4px',
      alignSelf: 'flex-start',
      maxWidth: '92%',
    }}>
      {/* Step indicator */}
      {isMulti && (
        <div style={{
          fontSize: '10.5px',
          fontWeight: 600,
          color: 'rgba(34,211,238,0.7)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          Question {step + 1} of {total}
        </div>
      )}

      {/* Question text */}
      <div style={{
        fontSize: '13.5px',
        color: 'rgba(255,255,255,0.85)',
        lineHeight: '1.5',
        fontWeight: 500,
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
