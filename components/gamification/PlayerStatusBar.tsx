'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useInvestorScore } from '@/hooks/useInvestorScore';
import { useAuth } from '@/components/providers/AuthProvider';
import { getLevelColor } from '@/lib/theme/utils';
import { ScoreDetailSheet } from './ScoreDetailSheet';
import { ALL_STYLES, getStyleContent } from '@/lib/content/investor-styles';

export function PlayerStatusBar() {
  const { score, level, progress, loading: scoreLoading } = useInvestorScore();
  const { user } = useAuth();

  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showScoreSheet, setShowScoreSheet] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [scoreChanged, setScoreChanged] = useState(false);
  const prevScoreRef = useRef(0);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const styleId = user?.investorStyle || 'buffett';
  const styleData = getStyleContent(styleId);
  const levelColor = getLevelColor(level);

  const streakDays = 0;
  const showWarning = false;

  // ── Score count-up animation ──────────────────────────
  useEffect(() => {
    if (scoreLoading) return;

    const prev = prevScoreRef.current;
    if (score !== prev) {
      const diff = score - prev;
      const steps = 20;
      const stepMs = 600 / steps;
      let step = 0;

      setScoreChanged(true);

      animTimerRef.current = setInterval(() => {
        step++;
        const t = step / steps;
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
      setDisplayScore(score);
    }

    prevScoreRef.current = score;
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, scoreLoading]);

  const selectStyle = useCallback(async (newStyle: string) => {
    sessionStorage.removeItem('vantage_greeting');

    if (user?.id) {
      try {
        await fetch('/api/db/users/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, investorStyle: newStyle }),
        });
      } catch {}
    }

    setShowStylePicker(false);
    window.location.reload();
  }, [user?.id]);

  return (
    <>
      {/* ── Main Bar ─────────────────────────────────── */}
      <div
        onClick={() => setShowScoreSheet(true)}
        className={`status-bar ${showWarning ? 'status-bar-warning' : ''}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setShowScoreSheet(true);
        }}
      >
        {/* ── Left: Streak ── */}
        <div className="status-streak">
          <span style={{ fontSize: 16 }}>🔥</span>
          <div>
            <div className="status-streak-num">{streakDays}</div>
            <div className="status-streak-label">day streak</div>
          </div>
        </div>

        {/* ── Center: Style ── */}
        <div
          onClick={(e) => { e.stopPropagation(); setShowStylePicker(true); }}
          className="status-style"
          style={{ cursor: 'pointer', padding: '0 8px' }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              setShowStylePicker(true);
            }
          }}
        >
          <span className="status-style-name">{styleData.shortLabel}</span>
          <span className="status-style-tag">{styleData.tag}</span>
        </div>

        {/* ── Right: Score + Level ── */}
        <div className="status-score">
          <span
            className="status-score-num"
            style={{ minWidth: scoreChanged ? undefined : '2.5em', textAlign: 'right' }}
          >
            {displayScore}
          </span>
          <div
            className="status-level-badge"
            style={{
              background: `${levelColor}26`,
              border: `1px solid ${levelColor}66`,
              gap: 4,
            }}
          >
            <span style={{ color: levelColor }}>{level}</span>
            <span style={{
              color: 'var(--gain)',
              opacity: 0.6,
              animation: 'vantageArrowPulse 30s ease-in-out infinite',
            }}>
              ↗
            </span>
          </div>
        </div>
      </div>

      {/* ── Score Detail Sheet ── */}
      <ScoreDetailSheet
        open={showScoreSheet}
        onClose={() => setShowScoreSheet(false)}
      />

      {/* ── Style Picker Modal ── */}
      {showStylePicker && (
        <div
          onClick={() => setShowStylePicker(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
          }} />

          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative', width: '100%', maxWidth: 360,
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 16, padding: 24,
              display: 'flex', flexDirection: 'column', gap: 16,
              animation: 'vantageSlideUp 0.25s ease-out',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                Investor Style
              </span>
              <button
                onClick={() => setShowStylePicker(false)}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--text-muted)', fontSize: 18,
                  cursor: 'pointer', padding: 4, lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Choose your investing style. Your AI advisor tailors its responses to match.
            </p>

            {ALL_STYLES.map((s) => {
              const isSelected = s.id === styleId;
              return (
                <button
                  key={s.id}
                  onClick={() => selectStyle(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 12,
                    border: isSelected
                      ? '1px solid var(--accent)'
                      : '1px solid var(--border-subtle)',
                    background: isSelected ? 'rgba(34,211,238,0.10)' : 'var(--bg-card-hover)',
                    cursor: 'pointer', transition: 'all 0.15s ease', width: '100%',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{s.emoji}</span>
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {s.shortLabel}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {s.tag}
                    </div>
                  </div>
                  {isSelected && (
                    <span style={{ color: 'var(--accent)', fontSize: 14 }}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes vantageArrowPulse {
          0%, 93% { opacity: 0.6; transform: scale(1); }
          96% { opacity: 1; transform: scale(1.25); }
          100% { opacity: 0.6; transform: scale(1); }
        }
      `}</style>
    </>
  );
}
