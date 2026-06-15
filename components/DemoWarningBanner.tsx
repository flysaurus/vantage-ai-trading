// ─── DemoWarningBanner ──────────────────────────────────────
// Amber warning banner shown at the top of content area
// when the demo period has ≤ 3 days remaining.
//
// Design: 40px height, amber (#f59e0b at 10% opacity),
// border-bottom amber. Dismissible per session via sessionStorage.
// "Save →" button opens auth modal for magic link sign-up.

'use client';

import React, { useState, useEffect } from 'react';

interface DemoWarningBannerProps {
  daysRemaining: number;
  onSaveProgress?: () => void;
}

export function DemoWarningBanner({ daysRemaining, onSaveProgress }: DemoWarningBannerProps) {
  const SESSION_DISMISS_KEY = 'vantage_demo_banner_dismissed';

  const [dismissed, setDismissed] = useState(false);

  // Check sessionStorage on mount
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === 'true') {
        setDismissed(true);
      }
    } catch {}
  }, []);

  // Reset dismissal if daysRemaining drops to a more urgent tier
  useEffect(() => {
    try {
      const lastKnown = sessionStorage.getItem('vantage_demo_banner_days');
      if (lastKnown !== null && parseInt(lastKnown, 10) > daysRemaining) {
        // Days decreased — re-show banner
        sessionStorage.removeItem(SESSION_DISMISS_KEY);
        sessionStorage.setItem('vantage_demo_banner_days', String(daysRemaining));
        setDismissed(false);
      }
      if (lastKnown === null) {
        sessionStorage.setItem('vantage_demo_banner_days', String(daysRemaining));
      }
    } catch {}
  }, [daysRemaining]);

  if (dismissed || daysRemaining > 3) return null;

  const isExpired = daysRemaining <= 0;

  const dismiss = () => {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, 'true');
      sessionStorage.setItem('vantage_demo_banner_days', String(daysRemaining));
    } catch {}
    setDismissed(true);
  };

  return (
    <div
      style={{
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px 0 16px',
        background: isExpired
          ? 'rgba(239, 68, 68, 0.12)'
          : 'rgba(245, 158, 11, 0.10)',
        borderBottom: isExpired
          ? '1px solid rgba(239, 68, 68, 0.25)'
          : '1px solid rgba(245, 158, 11, 0.25)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '13px' }}>{isExpired ? '⏰' : '⚡'}</span>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: isExpired ? '#fca5a5' : '#fbbf24',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isExpired
            ? 'Demo expired — save your progress'
            : daysRemaining === 1
              ? 'Demo expires tomorrow — save your progress'
              : `Demo expires in ${daysRemaining} days — save your progress`}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {onSaveProgress && (
          <button
            onClick={onSaveProgress}
            style={{
              background: isExpired
                ? 'rgba(239, 68, 68, 0.20)'
                : 'rgba(245, 158, 11, 0.15)',
              border: 'none',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              color: isExpired ? '#fca5a5' : '#fbbf24',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Save →
          </button>
        )}
        <button
          onClick={dismiss}
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
