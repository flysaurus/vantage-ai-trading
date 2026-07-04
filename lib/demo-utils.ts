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

  // ── Pure date (midnight-local), no time components ───
  const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startDate = dateOnly(start);
  const todayDate = dateOnly(now);
  const expiresDate = dateOnly(expires);

  const DAY_MS = 1000 * 60 * 60 * 24;

  // Total days from DB (not hardcoded — change demo duration in DB only)
  const totalDays = Math.round((expiresDate.getTime() - startDate.getTime()) / DAY_MS);

  // Calendar days elapsed (date-only subtraction)
  const daysSinceStart = Math.round((todayDate.getTime() - startDate.getTime()) / DAY_MS);

  const daysRemaining = Math.max(0, totalDays - daysSinceStart);

  return {
    daysRemaining,
    isExpired: daysRemaining <= 0,
    showWarning: daysRemaining <= 3 && daysRemaining > 0,
    percentUsed: Math.min(100, Math.round((daysSinceStart / totalDays) * 100)),
  };
}
