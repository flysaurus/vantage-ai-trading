'use client';

// ─── ProgressIndicator — Branded pipeline progress during AI generation ───
// Replaces raw model reasoning text with structured stage labels tied to
// actual backend pipeline stages. Uses the existing card-frost design system.

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
  const [visible, setVisible] = useState(false);

  // Brief fade-in delay for polish
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        opacity: stage === 0 ? 0 : 1,
        transition: 'opacity 0.35s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        {/* Stage steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
          {STAGES.map((s, i) => {
            const isCurrent = s.stage === stage;
            const isDone = s.stage < stage;
            const isPending = s.stage > stage;

            return (
              <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Step dot + label */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: isPending ? 0.35 : 1,
                    transition: 'opacity 0.4s ease',
                  }}
                >
                  {/* Dot */}
                  <div
                    style={{
                      width: isCurrent ? 10 : 8,
                      height: isCurrent ? 10 : 8,
                      borderRadius: '50%',
                      background: isDone
                        ? 'rgba(16, 185, 129, 0.7)'
                        : isCurrent
                          ? '#ffffff'
                          : 'rgba(255,255,255,0.2)',
                      boxShadow: isCurrent
                        ? '0 0 12px rgba(255,255,255,0.3)'
                        : 'none',
                      transition: 'all 0.4s ease',
                      flexShrink: 0,
                    }}
                  />

                  {/* Label */}
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: '13px',
                      fontWeight: isCurrent ? 600 : 400,
                      color: isDone
                        ? 'rgba(16, 185, 129, 0.9)'
                        : isCurrent
                          ? '#ffffff'
                          : 'rgba(255,255,255,0.35)',
                      transition: 'color 0.4s ease',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.label}
                  </span>
                </div>

                {/* Connector line between steps */}
                {i < STAGES.length - 1 && (
                  <div
                    style={{
                      width: '16px',
                      height: '1px',
                      background: isDone
                        ? 'rgba(16, 185, 129, 0.3)'
                        : 'rgba(255,255,255,0.08)',
                      transition: 'background 0.6s ease',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Spinner for current stage */}
        <div
          style={{
            width: '18px',
            height: '18px',
            border: '2px solid rgba(255,255,255,0.1)',
            borderTopColor: 'rgba(255,255,255,0.6)',
            borderRadius: '50%',
            animation: 'progressSpinner 0.8s linear infinite',
            flexShrink: 0,
          }}
        />
      </div>

      <style>{`
        @keyframes progressSpinner {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
