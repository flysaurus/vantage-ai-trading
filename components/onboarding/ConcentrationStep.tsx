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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background: 'var(--bg)',
        color: '#fff',
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
            color: 'rgba(255,255,255,0.70)',
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
              color: '#ffffff',
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
              color: '#ffffff',
            }}
          >
            you comfortable being?
          </span>
        </h2>

        <p
          style={{
            fontSize: '14px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.60)',
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
            background: 'rgba(34,211,238,0.10)',
            border: '1px solid rgba(34,211,238,0.25)',
            fontSize: '13px',
            fontWeight: 500,
            color: 'rgba(255,255,255,0.85)',
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
            const isHovered = hovered === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => onSelect(preset.single, preset.top3)}
                onMouseEnter={() => setHovered(preset.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  width: '100%',
                  padding: '18px 20px',
                  borderRadius: '16px',
                  border: isSuggested || isHovered
                    ? '2px solid rgba(6,182,212,0.55)'
                    : '2px solid rgba(255,255,255,0.08)',
                  background: isSuggested || isHovered
                    ? 'rgba(6,182,212,0.08)'
                    : 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background 0.2s',
                  textAlign: 'left' as const,
                  fontFamily: 'var(--font-sans)',
                  color: '#fff',
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
                            color: '#22d3ee',
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
                        color: 'rgba(255,255,255,0.55)',
                        lineHeight: 1.4,
                      }}
                    >
                      {preset.blurb}
                    </div>
                  </div>
                  <div
                    style={{
                      flexShrink: 0,
                      textAlign: 'right',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.70)',
                      lineHeight: 1.5,
                    }}
                  >
                    <div>{preset.single}% single</div>
                    <div>{preset.top3}% top&nbsp;3</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
