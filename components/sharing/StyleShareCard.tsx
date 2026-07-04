// ─── StyleShareCard ──────────────────────────────────────────
// Renders a shareable investor style card as an HTML div.
// Captured via html2canvas → PNG download or native share.
//
// Dimensions: 390 × 520px (portrait)
// Background: gradient #0a0f1e → #1a2235
//
// Sections: Header wordmark, Style visual (emoji + name + tagline),
// Stats row (Score | Level | Risk), Quote, Footer
//
// All colors via CSS design tokens.

'use client';

import React, { forwardRef } from 'react';
import { getLevelColor } from '@/lib/theme/utils';
import type { Level } from '@/lib/theme/tokens';

// ─── Style Visuals ───────────────────────────────────────────

export type ShareStyleId = 'buffett' | 'lynch' | 'livermore' | 'munger' | 'soros';

interface StyleVisual {
  emoji: string;
  name: string;
  tagline: string;
  quote: string;
  attribution: string;
}

const STYLE_VISUALS: Record<ShareStyleId, StyleVisual> = {
  buffett: {
    emoji: '🏛️',
    name: 'Buffett',
    tagline: 'Patient. Principled. Long-term.',
    quote: 'The stock market is a device for transferring money from the impatient to the patient.',
    attribution: 'Warren Buffett',
  },
  lynch: {
    emoji: '🔍',
    name: 'Lynch',
    tagline: 'Growth hunter. Always watching.',
    quote: 'Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it.',
    attribution: 'Peter Lynch',
  },
  livermore: {
    emoji: '📈',
    name: 'Livermore',
    tagline: 'Read the tape. Move with it.',
    quote: 'The big money is not in the buying and the selling, but in the waiting.',
    attribution: 'Jesse Livermore',
  },
  munger: {
    emoji: '🧠',
    name: 'Munger',
    tagline: 'Mental models. Rational edge.',
    quote: 'Invert, always invert.',
    attribution: 'Charlie Munger',
  },
  soros: {
    emoji: '🌐',
    name: 'Soros',
    tagline: 'Macro vision. Reflexive edge.',
    quote: "It's not whether you're right or wrong, but how much money you make when you're right.",
    attribution: 'George Soros',
  },
};

// ─── Props ────────────────────────────────────────────────────

interface StyleShareCardProps {
  styleId: ShareStyleId;
  score: number;
  level: Level;
  riskTolerance: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Component ───────────────────────────────────────────────

export const StyleShareCard = forwardRef<HTMLDivElement, StyleShareCardProps>(
  function StyleShareCard({ styleId, score, level, riskTolerance }, ref) {
    const visual = STYLE_VISUALS[styleId] || STYLE_VISUALS.lynch;
    const levelColor = getLevelColor(level);

    return (
      <div
        ref={ref}
        style={{
          width: '390px',
          height: '520px',
          background: 'linear-gradient(180deg, #0a0f1e 0%, #1a2235 100%)',
          borderRadius: '20px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          position: 'relative',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* ═══════════════════════════════════════════════
            SECTION 1: HEADER
            ═══════════════════════════════════════════════ */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px 0',
          flexShrink: 0,
        }}>
          {/* Vantage wordmark */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#22d3ee" strokeWidth="2" />
              <path d="M12 6v12M12 6l4 6-4 6M12 6l-4 6 4 6" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{
              fontSize: '14px',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-0.02em',
            }}>
              Vantage
            </span>
          </div>

          {/* URL */}
          <span style={{
            fontSize: '9px',
            color: '#94a3b8',
            fontWeight: 500,
          }}>
            vantage-ai-trading.vercel.app
          </span>
        </div>

        {/* ═══════════════════════════════════════════════
            SECTION 2: STYLE VISUAL
            ═══════════════════════════════════════════════ */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
          gap: '12px',
        }}>
          {/* Large emoji */}
          <span style={{
            fontSize: '80px',
            lineHeight: 1,
            filter: 'drop-shadow(0 4px 12px rgba(34, 211, 238, 0.15))',
          }}>
            {visual.emoji}
          </span>

          {/* Style name */}
          <span style={{
            fontSize: '32px',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
          }}>
            {visual.name}
          </span>

          {/* Tagline */}
          <span style={{
            fontSize: '14px',
            color: '#22d3ee',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}>
            {visual.tagline}
          </span>
        </div>

        {/* ═══════════════════════════════════════════════
            SECTION 3: STATS ROW
            ═══════════════════════════════════════════════ */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '0',
          padding: '20px 24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          {/* Score */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span style={{
              fontSize: '22px',
              fontWeight: 700,
              color: '#22d3ee',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {score}
            </span>
            <span style={{
              fontSize: '10px',
              color: '#e2e8f0',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Score
            </span>
          </div>

          {/* Divider */}
          <div style={{
            width: '1px',
            height: '40px',
            background: 'rgba(255,255,255,0.08)',
            alignSelf: 'center',
          }} />

          {/* Level */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span style={{
              fontSize: '16px',
              fontWeight: 700,
              color: levelColor,
            }}>
              {level}
            </span>
            <span style={{
              fontSize: '10px',
              color: '#e2e8f0',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Level
            </span>
          </div>

          {/* Divider */}
          <div style={{
            width: '1px',
            height: '40px',
            background: 'rgba(255,255,255,0.08)',
            alignSelf: 'center',
          }} />

          {/* Risk */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#ffffff',
            }}>
              {capitalize(riskTolerance)}
            </span>
            <span style={{
              fontSize: '10px',
              color: '#e2e8f0',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Risk
            </span>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════
            SECTION 4: QUOTE
            ═══════════════════════════════════════════════ */}
        <div style={{
          padding: '20px 28px',
          flexShrink: 0,
        }}>
          <p style={{
            fontSize: '13px',
            color: '#94a3b8',
            fontStyle: 'italic',
            lineHeight: 1.5,
            margin: '0 0 8px 0',
            textAlign: 'center',
          }}>
            &ldquo;{visual.quote}&rdquo;
          </p>
          <p style={{
            fontSize: '11px',
            color: '#e2e8f0',
            textAlign: 'center',
            margin: 0,
          }}>
            &mdash; {visual.attribution}
          </p>
        </div>

        {/* ═══════════════════════════════════════════════
            SECTION 5: FOOTER
            ═══════════════════════════════════════════════ */}
        <div style={{
          padding: '12px 24px 20px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          textAlign: 'center',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: '10px',
            color: '#94a3b8',
            fontWeight: 500,
            letterSpacing: '0.04em',
          }}>
            My Investor Style &middot; Vantage AI
          </span>
        </div>
      </div>
    );
  }
);
