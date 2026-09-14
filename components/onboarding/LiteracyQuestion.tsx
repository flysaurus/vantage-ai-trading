// ─── LiteracyQuestion ───────────────────────────────────────
// Single self-report question shown ONCE, after the investor-style archetype
// reveal screen and before the concentration thresholds step.
//
//   "How familiar are you with investing?"
//     • New to investing
//     • Some experience
//     • Experienced
//
// Skippable (top-bar "Skip" — same pattern as the other onboarding screens).
// The answer is a single stored string on the user record. No scoring, no
// quiz logic, no numeric assessment — ever.

'use client';

import React, { useState } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';

export type InvestmentExperience = 'new' | 'some' | 'experienced';

interface Option {
  id: InvestmentExperience;
  label: string;
  blurb: string;
}

const OPTIONS: Option[] = [
  {
    id: 'new',
    label: 'New to investing',
    blurb: "I'm just getting started.",
  },
  {
    id: 'some',
    label: 'Some experience',
    blurb: "I've bought and sold a few things.",
  },
  {
    id: 'experienced',
    label: 'Experienced',
    blurb: "I know my way around a portfolio.",
  },
];

interface LiteracyQuestionProps {
  onSelect: (value: InvestmentExperience) => void;
  onSkip: () => void;
  onBack: () => void;
}

export default function LiteracyQuestion({
  onSelect,
  onSkip,
  onBack,
}: LiteracyQuestionProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  // Two-step, matching ConcentrationStep: tapping a card only selects it; the
  // answer is committed with the button below the list.
  const [selected, setSelected] = useState<InvestmentExperience | null>(null);

  return (
    <div
      className="onboarding-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background:
          'radial-gradient(ellipse 100% 60% at 50% 0%, var(--v-accent-dim) 0%, transparent 72%), radial-gradient(ellipse 60% 40% at 80% 100%, var(--v-glow) 0%, transparent 60%), var(--v-canvas)',
        color: 'var(--v-text-primary)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          minHeight: '60px',
          position: 'relative',
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--v-text-secondary)',
            fontSize: '14px',
            fontWeight: 400,
            cursor: 'pointer',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--font-sans)',
            minHeight: '44px',
            WebkitTapHighlightColor: 'transparent',
            zIndex: 1,
          }}
          aria-label="Back to style reveal"
        >
          ‹ Back
        </button>

        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <VantageOrb size={44} animate showEntrance />
        </div>

        <button
          onClick={onSkip}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--v-text-muted)',
            fontSize: '14px',
            fontWeight: 400,
            cursor: 'pointer',
            padding: '8px 12px',
            fontFamily: 'var(--font-sans)',
            minHeight: '44px',
            WebkitTapHighlightColor: 'transparent',
            zIndex: 1,
          }}
          aria-label="Skip this question"
        >
          Skip
        </button>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 20px',
        }}
      >
        <h2
          style={{
            margin: '0 0 8px',
            textAlign: 'center',
            lineHeight: 1.15,
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '32px',
              fontWeight: 800,
              color: 'var(--v-text-primary)',
            }}
          >
            How familiar are
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '32px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--v-text-primary)',
            }}
          >
            you with investing?
          </span>
        </h2>

        <p
          style={{
            fontSize: '14px',
            fontWeight: 400,
            color: 'var(--v-text-muted)',
            textAlign: 'center',
            margin: '0 0 20px',
            lineHeight: 1.5,
            maxWidth: '320px',
          }}
        >
          This just helps us pitch things at the right level. There are no wrong
          answers.
        </p>

        {/* ── OPTION CARDS ── */}
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {OPTIONS.map((option: Option) => {
            const isSelected = option.id === selected;
            const isHovered = hovered === option.id;
            return (
              <button
                key={option.id}
                onClick={() => setSelected(option.id)}
                onMouseEnter={() => setHovered(option.id)}
                onMouseLeave={() => setHovered(null)}
                aria-pressed={isSelected}
                style={{
                  width: '100%',
                  padding: '18px 20px',
                  borderRadius: '16px',
                  border:
                    isSelected || isHovered
                      ? '2px solid var(--v-accent)'
                      : '2px solid var(--v-card-border)',
                  background:
                    isSelected || isHovered
                      ? 'var(--v-accent-dim)'
                      : 'var(--v-card)',
                  boxShadow: 'var(--v-shadow-card)', // locked elevation
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background 0.2s',
                  textAlign: 'left' as const,
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--v-text-primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '17px',
                        fontWeight: 700,
                        marginBottom: '3px',
                      }}
                    >
                      {option.label}
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 400,
                        color: 'var(--v-text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {option.blurb}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '13px',
                      fontWeight: 700,
                      lineHeight: 1,
                      background: isSelected ? 'var(--v-accent-button)' : 'transparent',
                      color: 'var(--v-accent-text)',
                      border: isSelected
                        ? '2px solid var(--v-accent-button)'
                        : '2px solid var(--v-card-border)',
                    }}
                  >
                    {isSelected ? '✓' : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── COMMIT ── */}
        <button
          onClick={() => selected && onSelect(selected)}
          disabled={!selected}
          style={{
            width: '100%',
            maxWidth: '380px',
            marginTop: '16px',
            minHeight: '52px',
            padding: '14px 20px',
            borderRadius: '14px',
            border: 'none',
            background: selected ? 'var(--v-accent-button)' : 'var(--v-disabled-bg)',
            color: selected ? 'var(--v-accent-text)' : 'var(--v-disabled-text)',
            fontSize: '16px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: selected ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
