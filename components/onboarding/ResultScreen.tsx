// ─── ResultScreen ──────────────────────────────────────────
// Final screen of the onboarding quiz.
//
// Sequence:
// 1. Compass burst (0-600ms)
// 2. Compass fades to style emoji (80px)
// 3. Typewriter: "You're a [STYLE] investor."
// 4. Style description fades in
// 5. Stats fade in staggered: risk badge, investor score
// 6. Override pills + "Enter Vantage →" CTA

'use client';

import React, { useState, useEffect } from 'react';
import type { InvestorStyle } from '@/types';
import { getStyleContent, getStyleDisplayName, RISK_COLORS, RISK_LABELS, ALL_STYLES } from '@/lib/onboarding/quiz-logic';
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
  const revealText = `You're a ${getStyleDisplayName(selectedStyle)} investor.`;
  const { displayText: typewriterText, isDone: typewriterDone } = useTypewriter(
    revealText,
    30,
    phase === 'reveal' ? 0 : 999999,
  );

  // Phase sequencing
  useEffect(() => {
    // Burst → reveal after 600ms
    const t1 = setTimeout(() => setPhase('reveal'), 600);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (!typewriterDone || phase !== 'reveal') return;
    // Wait 400ms after typewriter, then show stats
    const t = setTimeout(() => setPhase('stats'), 400);
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

          {/* Typewriter reveal text */}
          <h1
            style={{
              fontSize: '28px',
              fontWeight: 600,
              color: '#ffffff',
              textAlign: 'center',
              marginBottom: '12px',
              lineHeight: 1.3,
              maxWidth: '320px',
            }}
          >
            {typewriterText}
            {!typewriterDone && (
              <span className="cursor-blink" style={{ color: '#22d3ee' }}>|</span>
            )}
          </h1>

          {/* Style description — fades in after typewriter */}
          <p
            style={{
              fontSize: '16px',
              color: '#94a3b8',
              textAlign: 'center',
              lineHeight: 1.6,
              maxWidth: '300px',
              marginBottom: '24px',
              opacity: typewriterDone ? 1 : 0,
              transition: 'opacity 400ms ease',
            }}
          >
            {styleData.description}
          </p>

          {/* Stats — staggered fade in */}
          <div
            style={{
              opacity: phase === 'stats' || phase === 'done' ? 1 : 0,
              transition: 'opacity 400ms ease',
              transitionDelay: phase === 'stats' ? '0ms' : '0ms',
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
                padding: '8px 16px',
                background: `${riskColor}15`,
                border: `1px solid ${riskColor}40`,
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 500,
                color: riskColor,
                opacity: phase === 'stats' || phase === 'done' ? 1 : 0,
                transition: 'opacity 400ms ease',
                transitionDelay: '0ms',
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
                padding: '16px',
                background: '#1a2235',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '14px',
                textAlign: 'center',
                opacity: phase === 'stats' || phase === 'done' ? 1 : 0,
                transition: 'opacity 400ms ease',
                transitionDelay: '200ms',
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

          {/* Not quite right + override pills */}
          {(phase === 'stats' || phase === 'done') && (
            <div
              style={{
                width: '100%',
                marginBottom: '20px',
                opacity: phase === 'done' ? 1 : (phase === 'stats' ? 1 : 0),
                transition: 'opacity 400ms ease',
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
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStyle(s.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '10px 14px',
                        background: isActive ? 'rgba(34, 211, 238, 0.12)' : '#1a2235',
                        border: isActive ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        flexShrink: 0,
                        minWidth: '60px',
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>{s.emoji}</span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: isActive ? '#22d3ee' : '#64748b',
                        }}
                      >
                        {s.name}
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
