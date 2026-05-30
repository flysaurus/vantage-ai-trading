// ─── Inactivity Warning ──────────────────────────────────────
// Shows a banner when the user will be logged out in 1 minute
// due to inactivity. Hidden when session is active or absent.

'use client';

import { useAuth } from './AuthProvider';

export function InactivityWarning() {
  const { inactivityWarning, inactivityCountdown, isAuthenticated } = useAuth();

  if (!inactivityWarning || !isAuthenticated) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 90,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      background: 'rgba(250, 204, 21, 0.12)',
      border: '1px solid rgba(250, 204, 21, 0.35)',
      borderRadius: 12,
      padding: '10px 20px',
      color: '#facc15',
      fontSize: 13,
      fontWeight: 600,
      backdropFilter: 'blur(8px)',
      whiteSpace: 'nowrap',
      pointerEvents: 'auto',
      cursor: 'pointer',
      animation: 'fadeIn 0.3s ease-out',
    }} onClick={() => {
      // Tapping the warning resets the timer (user is active!)
      window.dispatchEvent(new Event('click'));
    }}>
      ⏰ Logging out in <strong>{inactivityCountdown || 60}s</strong> — tap to stay
    </div>
  );
}
