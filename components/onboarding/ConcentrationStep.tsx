// ─── ConcentrationStep ──────────────────────────────────────
// Onboarding question: "How concentrated are you comfortable being?"
// Reached after style-reveal, before broker-choice. Selection sets the
// per-user position-concentration alert thresholds (sent to /api/user/setup
// on account creation). A style-based suggestion is highlighted.

'use client';

import React, { useState } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import {
  CONCENTRATION_PRESETS,
  suggestedPresetForStyle,
  type ConcentrationPreset,
} from '@/lib/concentration';
import { getStyleContent } from '@/lib/content/investor-styles';
import type { InvestorStyleKey } from '@/lib/onboarding/onboarding-state';

interface ConcentrationStepProps {
  style: InvestorStyleKey;
  onSelect: (concSinglePct: number, concTop3Pct: number) => void;
  onBack: () => void;
}

export default function ConcentrationStep({
  style,
  onSelect,
  onBack,
}: ConcentrationStepProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const suggested = suggestedPresetForStyle(style);
  const styleLabel = getStyleContent(style).shortLabel;
  // Two-step interaction: tapping a card only selects it; the thresholds are
  // committed with the "Save & continue" button below the list. The suggested
  // preset is pre-selected so the recommendation stays the one-tap default.
  const [selected, setSelected] = useState<string>(suggested);
  const selectedPreset =
    CONCENTRATION_PRESETS.find((p) => p.id === selected) ??
    CONCENTRATION_PRESETS.find((p) => p.id === suggested) ??
    CONCENTRATION_PRESETS[0];

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

        <div style={{ width: '60px' }} />
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
            How concentrated are
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
            you comfortable being?
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
          We'll nudge you when a single bet — or your top three — grows
          past your comfort zone. You can fine-tune anytime in Settings.
        </p>

        {/* ── Recommendation ── */}
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            padding: '10px 14px',
            borderRadius: '10px',
            background: 'var(--v-accent-dim)',
            border: '1px solid var(--v-accent)',
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--v-text-primary)',
            textAlign: 'center',
            marginBottom: '16px',
          }}
        >
          ✨ Recommended for {styleLabel}: {CONCENTRATION_PRESETS.find((p) => p.id === suggested)?.label}
        </div>

        {/* ── PRESET CARDS ── */}
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {CONCENTRATION_PRESETS.map((preset: ConcentrationPreset) => {
            const isSuggested = preset.id === suggested;
            const isSelected = preset.id === selected;
            const isHovered = hovered === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => setSelected(preset.id)}
                onMouseEnter={() => setHovered(preset.id)}
                onMouseLeave={() => setHovered(null)}
                aria-pressed={isSelected}
                style={{
                  width: '100%',
                  padding: '18px 20px',
                  borderRadius: '16px',
                  border: isSelected || isSuggested || isHovered
                    ? '2px solid var(--v-accent)'
                    : '2px solid var(--v-card-border)',
                  background: isSelected || isSuggested || isHovered
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
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {preset.label}
                      {isSuggested && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: 'var(--v-accent-label)',
                          }}
                        >
                          Suggested
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 400,
                        color: 'var(--v-text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {preset.blurb}
                    </div>
                  </div>
                  <div
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <div
                      style={{
                        textAlign: 'right',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--v-text-secondary)',
                        lineHeight: 1.5,
                      }}
                    >
                      <div>{preset.single}% single</div>
                      <div>{preset.top3}% top&nbsp;3</div>
                    </div>
                    <span
                      aria-hidden
                      style={{
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
                </div>
              </button>
            );
          })}
        </div>

        {/* ── COMMIT ── */}
        <button
          onClick={() => onSelect(selectedPreset.single, selectedPreset.top3)}
          style={{
            width: '100%',
            maxWidth: '380px',
            marginTop: '16px',
            minHeight: '52px',
            padding: '14px 20px',
            borderRadius: '14px',
            border: 'none',
            background: 'var(--v-accent-button)',
            color: 'var(--v-accent-text)',
            fontSize: '16px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Save &amp; continue
        </button>
      </div>
    </div>
  );
}
