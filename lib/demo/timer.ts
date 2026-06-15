// ─── Demo Timer ──────────────────────────────────────────────
// Client-side demo status utilities.
// Works with localStorage timestamps set by lib/session/anonymous.ts.
//
// getDemoStatus() returns a full picture of the demo period:
// days remaining, expiration, warning state, percentage used.

const DEMO_DURATION_DAYS = 30;
const WARNING_THRESHOLD_DAYS = 3;

export interface DemoStatus {
  daysRemaining: number;
  isExpired: boolean;
  showWarning: boolean;
  expiresAt: Date;
  percentUsed: number;
  firstOpen: Date;
}

/**
 * Get the full demo status for the current session.
 *
 * Reads first_open from localStorage (set once on first visit).
 * If no first_open exists, sets it to now.
 *
 * Returns a DemoStatus object with:
 * - daysRemaining: integer days left (0 if expired)
 * - isExpired: true when daysRemaining ≤ 0
 * - showWarning: true when daysRemaining ≤ 3 (but not expired)
 * - expiresAt: Date when demo ends
 * - percentUsed: 0-100, how much of the 30-day demo is used
 * - firstOpen: Date of first visit
 */
export function getDemoStatus(): DemoStatus {
  const FIRST_OPEN_KEY = 'vantage_first_open';
  let firstOpen: Date;

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(FIRST_OPEN_KEY);
      if (stored) {
        firstOpen = new Date(stored);
      } else {
        firstOpen = new Date();
        localStorage.setItem(FIRST_OPEN_KEY, firstOpen.toISOString());
      }
    } catch {
      firstOpen = new Date();
    }
  } else {
    firstOpen = new Date();
  }

  const expiresAt = new Date(firstOpen);
  expiresAt.setDate(expiresAt.getDate() + DEMO_DURATION_DAYS);

  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / 86_400_000));
  const isExpired = daysRemaining <= 0;
  const showWarning = !isExpired && daysRemaining <= WARNING_THRESHOLD_DAYS;

  // Percent of demo period used
  const totalDemoMs = DEMO_DURATION_DAYS * 86_400_000;
  const elapsedMs = now.getTime() - firstOpen.getTime();
  const percentUsed = Math.min(100, Math.max(0, Math.round((elapsedMs / totalDemoMs) * 100)));

  return {
    daysRemaining,
    isExpired,
    showWarning,
    expiresAt,
    percentUsed,
    firstOpen,
  };
}
