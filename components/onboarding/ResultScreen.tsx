// ─── ResultScreen ──────────────────────────────────────────
// Final screen of the onboarding quiz.
//
// Trait-first structure: headline shows trait (e.g. "The Patient Builder"),
// investor name is a secondary tag below.
//
// Sequence:
// 1. Compass burst (0-600ms)
// 2. Compass fades to style emoji (80px)
// 3. Typewriter: "You're [TRAIT]."
// 4. Secondary tag fades in (e.g. "Buffett-style")
// 5. Style description fades in
// 6. Stats fade in staggered: risk badge, investor score
// 7. Override pills + "Enter Vantage →" CTA

'use client';

import React, { useState, useEffect } from 'react';
import type { InvestorStyle } from '@/types';
import { getStyleContent, getStyleTrait, getStyleTag, RISK_COLORS, RISK_LABELS, ALL_STYLES, PILL_TRAITS } from '@/lib/onboarding/quiz-logic';
import { CompassBurst } from '@/lib/animations/compass-burst';
import { useTypewriter } from '@/lib/animations/typewriter';
import { ShareCardModal } from '@/components/sharing/ShareCardModal';
import type { ShareStyleId } from '@/components/sharing/StyleShareCard';
import type { QuizResult } from '@/lib/onboarding/quiz-logic';

interface ResultScreenProps {
  result: QuizResult;
  userName: string;
  onEnter: (style: InvestorStyle, riskTolerance: string) => void;
}

export function ResultScreen({ result, userName, onEnter }: ResultScreenProps) {
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyle>(result.style);
  const [phase, setPhase] = useState<'burst' | 'reveal' | 'stats' | 'done'>('burst');
  const [showShareModal, setShowShareModal] = useState(false);

  const styleData = getStyleContent(selectedStyle);
  const trait = getStyleTrait(selectedStyle);
  const tag = getStyleTag(selectedStyle);
  const revealText = `You're ${trait}.`;
  const { displayText: typewriterText, isDone: typewriterDone } = useTypewriter(
    revealText,
    30,
    phase === 'reveal' ? 0 : 999999,
  );

  // Phase sequencing
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('reveal'), 600);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (!typewriterDone || phase !== 'reveal') return;
    const t = setTimeout(() => setPhase('stats'), 500);
    return () => clearTimeout(t);
  }, [typewriterDone, phase]);

  useEffect(() => {
    if (phase !== 'stats') return;
    const t = setTimeout(() => setPhase('done'), 600);
    return () => clearTimeout(t);
  }, [phase]);

  const riskColor = RISK_COLORS[
    result.riskTolerance === 'Conservative' ? 'conservative' :
    result.riskTolerance === 'Aggressive' ? 'aggressive' : 'moderate'
  ];

  return (
    <div
      style={{
        padding: '0 20px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 'max(40px, env(safe-area-inset-top, 20px) + 20px)',
      }}
    >
      {/* Phase 1: Compass burst */}
      {phase === 'burst' && (
        <div style={{ marginBottom: '24px' }}>
          <CompassBurst size={60} particleLength={40} />
        </div>
      )}

      {/* Phase 2+: Style reveal */}
      {(phase === 'reveal' || phase === 'stats' || phase === 'done') && (
        <>
          {/* Emoji scales in */}
          <div
            style={{
              fontSize: '80px',
              marginBottom: '16px',
              animation: 'scaleInSpring 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
            }}
          >
            {styleData.emoji}
          </div>

          {/* Typewriter reveal: "You're [TRAIT]." — trait in cyan */}
          <h1
            style={{
              fontSize: 'var(--onb-headline-size)',
              fontWeight: 'var(--onb-headline-weight)',
              color: 'var(--onb-headline-color)',
              textAlign: 'center',
              marginBottom: '10px',
              lineHeight: 1.3,
              maxWidth: '340px',
            }}
          >
            {typewriterText.slice(0, 7)}
            <span style={{ color: '#22d3ee' }}>{typewriterText.slice(7)}</span>
            {!typewriterDone && (
              <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
            )}
          </h1>

          {/* Secondary tag — fades in after typewriter */}
          <div
            style={{
              display: 'inline-flex',
              padding: '4px 10px',
              background: 'rgba(34,211,238,0.1)',
              border: '1px solid rgba(34,211,238,0.3)',
              borderRadius: '9999px',
              fontSize: '12px',
              color: '#94a3b8',
              fontWeight: 500,
              marginBottom: '16px',
              opacity: typewriterDone ? 1 : 0,
              transition: 'opacity 400ms ease',
              transitionDelay: '200ms',
            }}
          >
            {tag}
          </div>

          {/* Style description — fades in after typewriter */}
          <p
            style={{
              fontSize: 'var(--onb-body-size)',
              color: 'var(--onb-body-color)',
              textAlign: 'center',
              lineHeight: 'var(--onb-body-line-height)',
              maxWidth: '300px',
              marginBottom: '24px',
              opacity: typewriterDone ? 1 : 0,
              transition: 'opacity 400ms ease',
              transitionDelay: '400ms',
            }}
          >
            {styleData.description}
          </p>

          {/* Stats — staggered fade in */}
          <div
            style={{
              opacity: phase === 'stats' || phase === 'done' ? 1 : 0,
              transition: 'opacity 400ms ease',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '24px',
            }}
          >
            {/* Risk badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                background: `${riskColor}15`,
                border: `1px solid ${riskColor}40`,
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 500,
                color: riskColor,
              }}
            >
              <span style={{ fontSize: '11px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {RISK_LABELS[result.riskTolerance] || result.riskTolerance.toUpperCase()} RISK
              </span>
            </div>

            {/* Investor score */}
            <div
              style={{
                width: '100%',
                maxWidth: '320px',
                padding: '14px',
                background: '#1a2235',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '14px',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                Your starting score
              </p>
              <p style={{ fontSize: '36px', fontWeight: 700, color: '#22d3ee' }}>0</p>
              <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                Check back in 7 days
              </p>
            </div>
          </div>

          {/* Not quite right + override pills (two-line) */}
          {(phase === 'stats' || phase === 'done') && (
            <div
              style={{
                width: '100%',
                marginBottom: '20px',
              }}
            >
              <p
                style={{
                  fontSize: '13px',
                  color: '#64748b',
                  textAlign: 'center',
                  marginBottom: '10px',
                }}
              >
                Not quite right?
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  overflowX: 'auto',
                  padding: '0 0 4px',
                  justifyContent: 'center',
                  scrollbarWidth: 'none',
                }}
              >
                {ALL_STYLES.map((s) => {
                  const isActive = selectedStyle === s.id;
                  const sTag = getStyleTag(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStyle(s.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px',
                        padding: '8px 14px',
                        minHeight: '56px',
                        background: isActive ? 'rgba(34, 211, 238, 0.12)' : '#1a2235',
                        border: isActive ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        flexShrink: 0,
                        minWidth: '72px',
                      }}
                    >
                      <span style={{ fontSize: '16px', lineHeight: 1 }}>{s.emoji}</span>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: isActive ? '#22d3ee' : '#e2e8f0',
                          lineHeight: 1.2,
                        }}
                      >
                        {PILL_TRAITS[s.id]}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 400,
                          color: isActive ? '#67e8f9' : '#64748b',
                          lineHeight: 1.2,
                        }}
                      >
                        {sTag}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Enter Vantage CTA */}
          {phase === 'done' && (
            <>
              <button
                onClick={() => onEnter(selectedStyle, result.riskTolerance)}
                style={{
                  width: '100%',
                  maxWidth: '320px',
                  padding: '16px 0',
                  background: '#22d3ee',
                  border: 'none',
                  borderRadius: '14px',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#0a0f1e',
                  cursor: 'pointer',
                  transition: 'transform 150ms ease',
                  animation: 'fadeInUp 300ms ease forwards',
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.97)';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                Enter Vantage →
              </button>

              <button
                onClick={() => setShowShareModal(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#22d3ee',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '12px',
                  padding: '8px 16px',
                }}
              >
                Share your style ↗
              </button>
            </>
          )}
        </>
      )}

      {/* Share Modal */}
      <ShareCardModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        styleId={result.style as ShareStyleId}
        score={0}
        level="Apprentice"
        riskTolerance={result.riskTolerance}
      />

      <style>{`
        @keyframes scaleInSpring {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .cursor-blink {
          animation: blink 0.8s ease-in-out infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
