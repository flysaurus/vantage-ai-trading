// ─── ResultScreen ──────────────────────────────────────────
// Final screen of the onboarding quiz.
//
// Trait-first structure: headline shows trait (e.g. "The Patient Builder"),
// investor name is a secondary tag below.
//
// ⚠️ DIAGNOSTIC LOGGING ACTIVE — [RESULT_SCREEN] prefix.

'use client';

import React, { useState, useEffect, useRef } from 'react';
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

// ── DIAGNOSTIC: module-level render counter ─────────────────
let globalRenderCount = 0;

export function ResultScreen({ result, userName, onEnter }: ResultScreenProps) {
  // ── DIAGNOSTIC LOGGING REFS ───────────────────────────────
  const mountTime = useRef(Date.now());
  const renderCount = useRef(0);
  const mountedRef = useRef(false);

  renderCount.current += 1;
  globalRenderCount += 1;
  const rn = renderCount.current;
  const gn = globalRenderCount;

  if (!mountedRef.current) {
    mountedRef.current = true;
    console.log(`[RESULT_SCREEN] 🟢 MOUNT at ${new Date().toISOString()}`, {
      style: result.style,
      riskTolerance: result.riskTolerance,
      userName,
    });
  }

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

  // ── DIAGNOSTIC: log every render ──────────────────────────
  const elapsed = Date.now() - mountTime.current;
  console.log(`[RESULT_SCREEN] 🔄 RENDER #${rn} (global #${gn}) at +${elapsed}ms | phase="${phase}" style="${selectedStyle}" shareModal=${showShareModal} typewriterDone=${typewriterDone} typewriterText="${typewriterText}"`);

  // ── DIAGNOSTIC: state change interceptor (first 2s only) ──
  const wrappedSetSelectedStyle = useRef((v: InvestorStyle) => {
    console.log(`[RESULT_SCREEN] 🏷️  setSelectedStyle("${v}") at +${Date.now() - mountTime.current}ms`);
    setSelectedStyle(v);
  });

  // ── DIAGNOSTIC: intercept phase changes ───────────────────
  useEffect(() => {
    if (mountedRef.current) {
      console.log(`[RESULT_SCREEN] 🏷️  PHASE CHANGED → "${phase}" at +${Date.now() - mountTime.current}ms`);
    }
  }, [phase]);

  // Phase sequencing
  useEffect(() => {
    console.log(`[RESULT_SCREEN] ⏱️  Phase seq useEffect #1 FIRED at +${Date.now() - mountTime.current}ms — scheduling setPhase('reveal') in 600ms`);
    const t1 = setTimeout(() => {
      console.log(`[RESULT_SCREEN] ⏱️  Phase seq #1 CALLBACK → setPhase('reveal') at +${Date.now() - mountTime.current}ms`);
      setPhase('reveal');
    }, 600);
    return () => {
      console.log(`[RESULT_SCREEN] ⏱️  Phase seq useEffect #1 CLEANUP at +${Date.now() - mountTime.current}ms`);
      clearTimeout(t1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const e = Date.now() - mountTime.current;
    console.log(`[RESULT_SCREEN] ⏱️  Phase seq useEffect #2 FIRED at +${e}ms — typewriterDone=${typewriterDone} phase="${phase}"`);
    if (!typewriterDone || phase !== 'reveal') {
      console.log(`[RESULT_SCREEN] ⏱️  Phase seq #2 SKIPPED (typewriterDone=${typewriterDone}, phase="${phase}")`);
      return;
    }
    console.log(`[RESULT_SCREEN] ⏱️  Phase seq #2 → scheduling setPhase('stats') in 500ms`);
    const t = setTimeout(() => {
      console.log(`[RESULT_SCREEN] ⏱️  Phase seq #2 CALLBACK → setPhase('stats') at +${Date.now() - mountTime.current}ms`);
      setPhase('stats');
    }, 500);
    return () => clearTimeout(t);
  }, [typewriterDone, phase]);

  useEffect(() => {
    const e = Date.now() - mountTime.current;
    console.log(`[RESULT_SCREEN] ⏱️  Phase seq useEffect #3 FIRED at +${e}ms — phase="${phase}"`);
    if (phase !== 'stats') {
      console.log(`[RESULT_SCREEN] ⏱️  Phase seq #3 SKIPPED (phase="${phase}")`);
      return;
    }
    console.log(`[RESULT_SCREEN] ⏱️  Phase seq #3 → scheduling setPhase('done') in 600ms`);
    const t = setTimeout(() => {
      console.log(`[RESULT_SCREEN] ⏱️  Phase seq #3 CALLBACK → setPhase('done') at +${Date.now() - mountTime.current}ms`);
      setPhase('done');
    }, 600);
    return () => clearTimeout(t);
  }, [phase]);

  // ── DIAGNOSTIC: typewriter start/complete logging ─────────
  useEffect(() => {
    const e = Date.now() - mountTime.current;
    if (phase === 'reveal' && !typewriterDone && typewriterText.length === 0) {
      console.log(`[RESULT_SCREEN] ⌨️  TYPEWRITER STARTING at +${e}ms — text="${revealText}" speed=30ms`);
    }
    console.log(`[RESULT_SCREEN] ⌨️  typewriter progress — "${typewriterText}" (${typewriterText.length}/${revealText.length}) done=${typewriterDone}`);
  }, [typewriterText, typewriterDone, phase, revealText]);

  // ── DIAGNOSTIC: CSS var check ─────────────────────────────
  if (typeof window !== 'undefined' && renderCount.current === 1) {
    try {
      const style = getComputedStyle(document.documentElement);
      const headlineSize = style.getPropertyValue('--onb-headline-size').trim();
      const headlineWeight = style.getPropertyValue('--onb-headline-weight').trim();
      const headlineColor = style.getPropertyValue('--onb-headline-color').trim();
      const bodySize = style.getPropertyValue('--onb-body-size').trim();
      const bodyColor = style.getPropertyValue('--onb-body-color').trim();
      console.log(`[RESULT_SCREEN] 🎨 CSS VARS → headlineSize="${headlineSize}" headlineWeight="${headlineWeight}" headlineColor="${headlineColor}" bodySize="${bodySize}" bodyColor="${bodyColor}"`);
      if (!headlineSize) console.warn(`[RESULT_SCREEN] ⚠️  --onb-headline-size is EMPTY — headline may render at 0px!`);
      if (!headlineColor || headlineColor === '') console.warn(`[RESULT_SCREEN] ⚠️  --onb-headline-color is EMPTY — headline may be transparent!`);
    } catch (e) {
      console.error('[RESULT_SCREEN] Failed to read CSS vars:', e);
    }
  }

  // ── DIAGNOSTIC: log the revealText and trait ──────────────
  if (renderCount.current === 1) {
    console.log(`[RESULT_SCREEN] 📝 CONTENT → trait="${trait}" tag="${tag}" revealText="${revealText}" style=${selectedStyle}`);
  }

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
                      onClick={() => {
                        console.log(`[RESULT_SCREEN] 🖱️  Override pill clicked: "${s.id}" at +${Date.now() - mountTime.current}ms`);
                        setSelectedStyle(s.id);
                      }}
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
                onClick={() => {
                  console.log(`[RESULT_SCREEN] 🚀 "Enter Vantage →" CLICKED at +${Date.now() - mountTime.current}ms — style="${selectedStyle}" risk="${result.riskTolerance}"`);
                  onEnter(selectedStyle, result.riskTolerance);
                }}
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
                onClick={() => {
                  console.log(`[RESULT_SCREEN] 📤 "Share your style" CLICKED at +${Date.now() - mountTime.current}ms`);
                  setShowShareModal(true);
                }}
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
