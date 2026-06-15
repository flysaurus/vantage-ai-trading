// ─── PlayerStatusBar ─────────────────────────────────────────
// Persistent engagement layer visible across all tabs.
// Replaces the DemoWarningBanner from Phase 3.
//
// Layout: [🔥 streak] [Lynch Growth Style] [347 · Trader ↗]
// - Full bar tappable → ScoreDetailSheet (placeholder, built Prompt 3)
// - Center text tappable → style picker modal
// - ≤3 days remaining → amber left border warning
// - Score counts up with CSS animation on change (600ms)
//
// All colors via CSS design tokens (lib/theme/tokens.css).

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useInvestorScore } from '@/hooks/useInvestorScore';
import { useAnonymousSession } from '@/hooks/useAnonymousSession';
import { useAuth } from '@/components/providers/AuthProvider';
import { getLevelColor } from '@/lib/theme/utils';

// ─── Investor Style Definitions (inline, matching SettingsTab) ─

const INVESTOR_STYLES = [
  { id: 'lynch', name: 'Peter Lynch', subtitle: 'Growth', emoji: '📈' },
  { id: 'buffett', name: 'Warren Buffett', subtitle: 'Value', emoji: '🏰' },
  { id: 'livermore', name: 'Jesse Livermore', subtitle: 'Momentum', emoji: '⚡' },
  { id: 'munger', name: 'Charlie Munger', subtitle: 'Quality', emoji: '🎯' },
  { id: 'soros', name: 'George Soros', subtitle: 'Macro', emoji: '🌍' },
];

const STYLE_LABELS: Record<string, string> = {
  lynch: 'Lynch · Growth',
  buffett: 'Buffett · Value',
  livermore: 'Livermore · Momentum',
  munger: 'Munger · Quality',
  soros: 'Soros · Macro',
};

// ─── Component ───────────────────────────────────────────────

export function PlayerStatusBar() {
  const { score, level, progress, loading: scoreLoading } = useInvestorScore();
  const { daysRemaining, streak } = useAnonymousSession();
  const { user } = useAuth();

  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showScoreSheet, setShowScoreSheet] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [scoreChanged, setScoreChanged] = useState(false);
  const prevScoreRef = useRef(0);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derive investor style ──
  const styleId = user?.investorStyle || 'buffett';
  const styleLabel = STYLE_LABELS[styleId] || 'Buffett · Value';
  const styleName = INVESTOR_STYLES.find(s => s.id === styleId)?.name || 'Warren Buffett';

  // ── Level color ──
  const levelColor = getLevelColor(level);

  // ── Streak value ──
  const streakDays = streak?.current_streak || 0;
  const showWarning = daysRemaining <= 3;

  // ── Score count-up animation ──────────────────────────
  useEffect(() => {
    if (scoreLoading) return;

    const prev = prevScoreRef.current;
    if (score !== prev) {
      // Animate from previous to new score over 600ms
      const diff = score - prev;
      const steps = 20;
      const stepMs = 600 / steps;
      let step = 0;

      setScoreChanged(true);

      animTimerRef.current = setInterval(() => {
        step++;
        const t = step / steps;
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const current = Math.round(prev + diff * eased);
        setDisplayScore(current);

        if (step >= steps) {
          setDisplayScore(score);
          setScoreChanged(false);
          if (animTimerRef.current) clearInterval(animTimerRef.current);
        }
      }, stepMs);
    } else if (displayScore === 0 && score > 0) {
      // Initial load — just set
      setDisplayScore(score);
    }

    prevScoreRef.current = score;
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, scoreLoading]);

  // ── Style save ───────────────────────────────────────
  const selectStyle = useCallback(async (newStyle: string) => {
    if (!user?.id) return;
    try {
      const res = await fetch('/api/db/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, investorStyle: newStyle }),
      });
      if (res.ok) {
        localStorage.setItem('vantage_investor_style', newStyle);
        // Clear cached greeting so next greeting reflects new style
        sessionStorage.removeItem('vantage_greeting');
        window.location.reload();
      }
    } catch {}
    setShowStylePicker(false);
  }, [user?.id]);

  // ── Render ───────────────────────────────────────────

  return (
    <>
      {/* ── Main Bar ─────────────────────────────────── */}
      <div
        onClick={() => setShowScoreSheet(true)}
        style={{
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-subtle)',
          borderLeft: showWarning
            ? '1px solid var(--status-warning)'
            : '1px solid transparent',
          cursor: 'pointer',
          flexShrink: 0,
          userSelect: 'none',
          transition: 'border-left-color var(--transition-base)',
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setShowScoreSheet(true);
        }}
      >
        {/* ── Left: Streak ───────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          flexShrink: 0,
          minWidth: '70px',
        }}>
          <span style={{
            fontSize: '16px',
            color: 'var(--streak-color)',
            lineHeight: 1,
          }}>
            🔥
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              {streakDays}
            </span>
            <span style={{
              fontSize: '9px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {streakDays === 1 ? 'day' : 'days'}
            </span>
          </div>
        </div>

        {/* ── Center: Style ──────────────────────────── */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            setShowStylePicker(true);
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            lineHeight: 1.2,
            cursor: 'pointer',
            padding: '0 var(--space-2)',
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              setShowStylePicker(true);
            }
          }}
        >
          <span style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--text-secondary)',
          }}>
            {styleLabel}
          </span>
          <span style={{
            fontSize: '9px',
            color: 'var(--text-muted)',
          }}>
            {INVESTOR_STYLES.find(s => s.id === styleId)?.emoji} {styleName}
          </span>
        </div>

        {/* ── Right: Score + Level ───────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexShrink: 0,
        }}>
          {/* Score number */}
          <span style={{
            fontSize: '16px',
            fontWeight: 600,
            color: 'var(--accent-primary)',
            fontVariantNumeric: 'tabular-nums',
            minWidth: scoreChanged ? undefined : '2.5em',
            textAlign: 'right',
            transition: scoreChanged ? 'none' : 'color var(--transition-fast)',
          }}>
            {displayScore}
          </span>

          {/* Level badge pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 10px',
            borderRadius: 'var(--radius-full)',
            background: `${levelColor}26`, // 15% opacity
            border: `1px solid ${levelColor}66`, // 40% opacity
          }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              color: levelColor,
              lineHeight: 1.4,
            }}>
              {level}
            </span>
            <span style={{
              fontSize: '11px',
              color: scoreChanged
                ? 'var(--status-gain)'
                : 'var(--status-gain)',
              lineHeight: 1,
              opacity: scoreChanged ? 1 : 0.6,
              transition: 'opacity var(--transition-base)',
            }}>
              ↗
            </span>
          </div>
        </div>
      </div>

      {/* ── Score Detail Sheet (placeholder) ──────────── */}
      {showScoreSheet && (
        <div
          onClick={() => setShowScoreSheet(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          {/* Backdrop */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
          }} />

          {/* Sheet */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '480px',
              maxHeight: '70vh',
              background: 'var(--bg-sheet)',
              borderTopLeftRadius: 'var(--radius-lg)',
              borderTopRightRadius: 'var(--radius-lg)',
              padding: 'var(--space-6)',
              paddingBottom: 'calc(var(--space-6) + env(safe-area-inset-bottom, 0px))',
              animation: 'vantageSlideUp 0.3s ease-out',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-4)',
            }}
          >
            {/* Handle */}
            <div style={{
              width: '36px',
              height: '4px',
              borderRadius: '2px',
              background: 'var(--border-card)',
              marginBottom: 'var(--space-2)',
            }} />

            {/* Level badge (large) */}
            <div style={{
              padding: '6px 20px',
              borderRadius: 'var(--radius-full)',
              background: `${levelColor}26`,
              border: `1px solid ${levelColor}66`,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{ fontSize: '18px', color: levelColor, fontWeight: 700 }}>
                {level}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--status-gain)' }}>↗</span>
            </div>

            {/* Score */}
            <span style={{
              fontSize: '48px',
              fontWeight: 800,
              color: 'var(--accent-primary)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
            }}>
              {displayScore}
            </span>

            {/* Progress bar */}
            <div style={{ width: '100%', maxWidth: '300px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Progress to next level
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {progress}%
                </span>
              </div>
              <div style={{
                width: '100%',
                height: '6px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--border-subtle)',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${progress}%`,
                  height: '100%',
                  borderRadius: 'var(--radius-full)',
                  background: `linear-gradient(90deg, var(--accent-primary), ${levelColor})`,
                  transition: 'width var(--transition-slow)',
                }} />
              </div>
            </div>

            {/* Message */}
            <p style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              lineHeight: 1.5,
              maxWidth: '280px',
            }}>
              {level === 'Legend'
                ? 'You\'ve reached the highest level. Incredible.'
                : progress < 30
                  ? 'Keep trading and building baskets to climb the ranks.'
                  : progress < 70
                    ? 'You\'re making great progress. Stay consistent.'
                    : 'Almost there — keep pushing forward.'}
            </p>

            {/* Close button */}
            <button
              onClick={() => setShowScoreSheet(false)}
              style={{
                marginTop: 'var(--space-2)',
                padding: '8px 32px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Style Picker Modal ────────────────────────── */}
      {showStylePicker && (
        <div
          onClick={() => setShowStylePicker(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
        >
          {/* Backdrop */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
          }} />

          {/* Modal */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '360px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
              animation: 'vantageSlideUp 0.25s ease-out',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}>
                Investor Style
              </span>
              <button
                onClick={() => setShowStylePicker(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <p style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}>
              Choose your investing style. Your AI advisor tailors its responses to match.
            </p>

            {INVESTOR_STYLES.map((s) => {
              const isSelected = s.id === styleId;
              return (
                <button
                  key={s.id}
                  onClick={() => selectStyle(s.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-card)',
                    background: isSelected
                      ? 'var(--accent-primary-10)'
                      : 'var(--bg-card-hover)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    width: '100%',
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{s.emoji}</span>
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                    }}>
                      {s.name}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                    }}>
                      {s.subtitle} Focus
                    </div>
                  </div>
                  {isSelected && (
                    <span style={{ color: 'var(--accent-primary)', fontSize: '14px' }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Slide-up keyframe ────────────────────────── */}
      <style>{`
        @keyframes vantageSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
