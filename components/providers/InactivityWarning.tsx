// ─── Inactivity Warning + Welcome Back Toast ──────────────────
// Shows a personalized warning overlay 2 minutes before session
// expires (at 13 min of inactivity). Also shows a welcome-back
// toast on fresh login.
//
// Mounted globally in app/layout.tsx.

'use client';

import { useAuth } from './AuthProvider';

export function InactivityWarning() {
  const {
    inactivityWarning,
    inactivityCountdown,
    isAuthenticated,
    user,
    resetActivity,
    signOut,
  } = useAuth();

  if (!isAuthenticated) return null;

  const userInitial = user?.name?.[0]?.toUpperCase()
    || user?.email?.[0]?.toUpperCase()
    || 'M';

  const handleSignOut = () => {
    signOut();
  };

  const handleKeepMeIn = () => {
    resetActivity();
  };

  return (
    <>
      {/* ─── Inactivity Warning Overlay ─── */}
      {inactivityWarning && (
        <>
          {/* Backdrop */}
          <div
            onClick={handleKeepMeIn}
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
              color: '#6b7280',
              fontSize: '13px',
              lineHeight: '1.5',
              marginBottom: '24px',
            }}>
              Your session will end in{' '}
              <span style={{
                color: '#f59e0b',
                fontWeight: '600',
              }}>
                2 minutes
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
                  width: `${Math.round((inactivityCountdown || 120) / 120 * 100)}%`,
                  background: '#f59e0b',
                  borderRadius: '2px',
                  transition: 'width 1s linear',
                }}
              />
            </div>

            {/* Buttons */}
            <button
              onClick={handleKeepMeIn}
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
              onClick={handleSignOut}
              style={{
                background: 'none',
                border: 'none',
                color: '#4b5563',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Sign out now
            </button>
          </div>
        </>
      )}
    </>
  );
}
