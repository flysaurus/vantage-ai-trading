// ─── Inactivity Warning ──────────────────────────────────────
// Shows a centered overlay (20% of screen) when the user is
// about to be logged out due to inactivity. Tap anywhere to reset.
// Hidden when session is active or user is not authenticated.

'use client';

import { useAuth } from './AuthProvider';

export function InactivityWarning() {
  const { inactivityWarning, inactivityCountdown, isAuthenticated } = useAuth();

  if (!inactivityWarning || !isAuthenticated) return null;

  const seconds = inactivityCountdown || 60;
  const isCritical = seconds <= 15;

  const handleTap = () => {
    window.dispatchEvent(new Event('click'));
  };

  return (
    <>
      {/* Semi-transparent backdrop */}
      <div
        onClick={handleTap}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9998,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(2px)',
          animation: 'fadeIn 0.3s ease-out',
        }}
      />

      {/* Centered warning panel — ~20% of screen */}
      <div
        onClick={handleTap}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          width: 'min(360px, 85vw)',
          maxWidth: '90vw',
          background: `linear-gradient(135deg, ${isCritical ? '#7f1d1d' : '#1e1b4b'}, ${isCritical ? '#450a0a' : '#0f172a'})`,
          border: `2px solid ${isCritical ? 'rgba(239, 68, 68, 0.6)' : 'rgba(250, 204, 21, 0.5)'}`,
          borderRadius: 20,
          padding: '32px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          textAlign: 'center',
          cursor: 'pointer',
          animation: 'fadeInScale 0.3s ease-out',
          boxShadow: isCritical
            ? '0 0 60px rgba(239, 68, 68, 0.3)'
            : '0 0 40px rgba(250, 204, 21, 0.15)',
        }}
      >
        {/* Icon */}
        <div style={{
          fontSize: 48,
          lineHeight: 1,
          filter: isCritical ? 'grayscale(0)' : 'grayscale(0)',
        }}>
          ⏰
        </div>

        {/* Countdown — the big number */}
        <div style={{
          fontSize: 64,
          fontWeight: 900,
          lineHeight: 1,
          color: isCritical ? '#ef4444' : '#facc15',
          fontFamily: 'monospace',
          letterSpacing: -2,
          transition: 'color 0.3s ease',
        }}>
          {seconds}s
        </div>

        {/* Main text */}
        <div style={{
          fontSize: 16,
          fontWeight: 600,
          color: isCritical ? '#fca5a5' : '#fde68a',
          lineHeight: 1.4,
        }}>
          Logging out due to inactivity
        </div>

        {/* Tap prompt */}
        <div style={{
          fontSize: 14,
          color: '#94a3b8',
          lineHeight: 1.4,
        }}>
          Tap anywhere to stay signed in
        </div>

        {/* Pulsing indicator */}
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: isCritical ? '#ef4444' : '#facc15',
          animation: 'pulse 1s ease-in-out infinite',
        }} />
      </div>

      <style jsx>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.6); }
        }
      `}</style>
    </>
  );
}
