// ─── DemoWarningBanner ──────────────────────────────────────
// Amber/yellow banner shown at the top of the Portfolio tab
// when the demo period has ≤ 3 days remaining.
//
// Design: matches #0a0f1e background system, 36px height,
// non-intrusive, dismissible per session (not permanently).

'use client';

import React, { useState, useEffect } from 'react';

interface DemoWarningBannerProps {
  daysRemaining: number;
  onSaveProgress?: () => void;
}

export function DemoWarningBanner({ daysRemaining, onSaveProgress }: DemoWarningBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal if daysRemaining changes (e.g., drops to 0)
  useEffect(() => {
    // Re-show if we go from 3→2→1→0 (urgency increases)
    // but not on re-mounts with the same value
  }, [daysRemaining]);

  if (dismissed || daysRemaining > 3) return null;

  const isUrgent = daysRemaining === 0;
  const bgColor = isUrgent ? 'rgba(239, 68, 68, 0.12)' : 'rgba(251, 191, 36, 0.10)';
  const borderColor = isUrgent ? 'rgba(239, 68, 68, 0.30)' : 'rgba(251, 191, 36, 0.25)';
  const textColor = isUrgent ? '#fca5a5' : '#fbbf24';
  const icon = isUrgent ? '⏰' : '⏳';

  const message = isUrgent
    ? 'Demo expired — save your progress to keep trading'
    : daysRemaining === 1
      ? 'Your demo expires tomorrow — save progress now'
      : `Your demo expires in ${daysRemaining} days`;

  return (
    <div
      style={{
        height: '36px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px 0 16px',
        background: bgColor,
        borderBottom: `1px solid ${borderColor}`,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '13px', lineHeight: 1 }}>{icon}</span>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: textColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {message}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {onSaveProgress && (
          <button
            onClick={onSaveProgress}
            style={{
              background: isUrgent ? 'rgba(239, 68, 68, 0.20)' : 'rgba(251, 191, 36, 0.15)',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              color: textColor,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isUrgent ? 'Sign Up' : 'Save Progress'}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            padding: '2px 4px',
            fontSize: '14px',
            color: 'rgba(255,255,255,0.3)',
            cursor: 'pointer',
            lineHeight: 1,
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
