// ─── Demo Status Utilities ───────────────────────────────────
// Calculates days remaining, expiration status, and warning state
// based on demo_start_at and demo_expires_at timestamps.

export interface DemoStatus {
  daysRemaining: number;
  isExpired: boolean;
  showWarning: boolean;
  percentUsed: number;
}

export function getDemoStatus(
  demoStartAt: string | null,
  demoExpiresAt: string | null
): DemoStatus {
  const defaults: DemoStatus = {
    daysRemaining: 30,
    isExpired: false,
    showWarning: false,
    percentUsed: 0,
  };

  if (!demoStartAt || !demoExpiresAt) {
    return defaults;
  }

  const now = new Date();
  const expires = new Date(demoExpiresAt);
  const start = new Date(demoStartAt);

  const msRemaining = expires.getTime() - now.getTime();
  const daysRemaining = Math.max(
    0,
    Math.ceil(msRemaining / (1000 * 60 * 60 * 24))
  );

  const totalMs = 30 * 24 * 60 * 60 * 1000;
  const usedMs = now.getTime() - start.getTime();
  const percentUsed = Math.min(
    100,
    Math.round((usedMs / totalMs) * 100)
  );

  return {
    daysRemaining,
    isExpired: daysRemaining <= 0,
    showWarning: daysRemaining <= 3,
    percentUsed,
  };
}
