'use client';

// ─── ProgressIndicator — Branded pipeline progress during AI generation ───
// Shows current stage with icon + label + spinner. Stages are displayed
// as a compact row of dots below for context, never overlapping text.

import { useEffect, useState } from 'react';

const STAGES = [
  { stage: 1, label: 'Researching markets', icon: '🔍' },
  { stage: 2, label: 'Building your portfolio', icon: '📊' },
  { stage: 3, label: 'Validating recommendations', icon: '✅' },
];

interface ProgressIndicatorProps {
  currentStage: { stage: number; total: number } | null;
}

export function ProgressIndicator({ currentStage }: ProgressIndicatorProps) {
  const stage = currentStage?.stage ?? 0;
  const current = STAGES.find(s => s.stage === stage) || STAGES[0];
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Active stage: icon + label + spinner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '16px', lineHeight: 1 }}>{current.icon}</span>
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          fontWeight: 500,
          color: '#fff',
          whiteSpace: 'nowrap',
        }}>
          {current.label}
        </span>
        <div style={{
          width: '16px', height: '16px',
          border: '2px solid rgba(255,255,255,0.1)',
          borderTopColor: 'rgba(255,255,255,0.5)',
          borderRadius: '50%',
          animation: 'progressSpinner 0.8s linear infinite',
          flexShrink: 0,
          marginLeft: '2px',
        }} />
      </div>

      {/* Stage dots: compact row showing all 3 stages */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {STAGES.map((s, i) => {
          const isCurrent = s.stage === stage;
          const isDone = s.stage < stage;
          return (
            <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: isCurrent ? 8 : 6,
                height: isCurrent ? 8 : 6,
                borderRadius: '50%',
                background: isDone
                  ? 'rgba(16, 185, 129, 0.5)'
                  : isCurrent
                    ? '#fff'
                    : 'rgba(255,255,255,0.15)',
                transition: 'all 0.4s ease',
                flexShrink: 0,
              }} />
              <span style={{
                fontSize: '10px',
                fontWeight: isCurrent ? 500 : 400,
                color: isDone
                  ? 'rgba(16, 185, 129, 0.5)'
                  : isCurrent
                    ? 'rgba(255,255,255,0.5)'
                    : 'rgba(255,255,255,0.2)',
                whiteSpace: 'nowrap',
                transition: 'color 0.4s ease',
              }}>
                {s.label}
              </span>
              {i < STAGES.length - 1 && (
                <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: '10px' }}>·</span>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes progressSpinner {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
