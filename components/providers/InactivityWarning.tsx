// ─── Inactivity Warning — Modal + Auto-Sign-Out ───────────────
// Shows a personalized warning overlay 2 minutes before session
// expires (at 8 min of inactivity, sign-out at 10 min).
//
// Mounted globally in app/layout.tsx, only activates when user
// is authenticated (Supabase session present).

'use client';

import { useInactivity } from '@/hooks/useInactivity';
import { useEffect, useState } from 'react';

export function InactivityWarning() {
  const { showWarning, countdown, resetActivity, signOutNow } = useInactivity();
  const [userInitial, setUserInitial] = useState('V');

  // Fetch user's initial for personalized message
  useEffect(() => {
    if (!showWarning) return;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const u = data?.user;
        const name = u?.first_name || u?.email?.split('@')[0] || 'V';
        setUserInitial(name[0]?.toUpperCase() || 'V');
      })
      .catch(() => setUserInitial('V'));
  }, [showWarning]);

  if (!showWarning) return null;

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const timeDisplay = minutes > 0
    ? `${minutes}m ${seconds}s`
    : `${seconds}s`;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={resetActivity}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: 99998,
        }}
      />

      {/* Personalized warning modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 99999,
          background: '#1a2235',
          border: '1px solid rgba(34,211,238,0.2)',
          borderRadius: '20px',
          padding: '28px 24px',
          width: '320px',
          maxWidth: 'calc(100vw - 32px)',
          textAlign: 'center',
        }}
      >
        {/* Compass icon */}
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: 'rgba(34,211,238,0.1)',
          border: '1px solid rgba(34,211,238,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          fontSize: '22px',
        }}>
          🧭
        </div>

        {/* Personalized message */}
        <div style={{
          color: '#ffffff',
          fontSize: '18px',
          fontWeight: '600',
          marginBottom: '8px',
        }}>
          Still with us, {userInitial}?
        </div>

        <div style={{
          color: '#cbd5e1',
          fontSize: '13px',
          lineHeight: '1.5',
          marginBottom: '24px',
        }}>
          Your session will end in{' '}
          <span style={{
            color: '#f59e0b',
            fontWeight: '600',
          }}>
            {timeDisplay}
          </span>
          {' '}to keep your portfolio secure.
        </div>

        {/* Countdown bar */}
        <div style={{
          height: '3px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '2px',
          marginBottom: '20px',
          overflow: 'hidden',
        }}>
          <div
            style={{
              height: '100%',
              width: `${Math.round((countdown / 120) * 100)}%`,
              background: countdown < 30 ? '#ef4444' : '#f59e0b',
              borderRadius: '2px',
              transition: 'width 1s linear',
            }}
          />
        </div>

        {/* Buttons */}
        <button
          onClick={resetActivity}
          style={{
            width: '100%',
            padding: '14px',
            background: '#22d3ee',
            color: '#0a0f1e',
            border: 'none',
            borderRadius: '12px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: 'pointer',
            marginBottom: '12px',
          }}
        >
          Keep me in →
        </button>

        <button
          onClick={signOutNow}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Sign out now
        </button>
      </div>
    </>
  );
}
