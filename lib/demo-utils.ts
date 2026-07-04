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
  const totalDemoDays = Math.round((expiresDate.getTime() - startDate.getTime()) / DAY_MS);
  const daysSinceStart = Math.round((todayDate.getTime() - startDate.getTime()) / DAY_MS);

  // Display: today is in-progress → subtract it (i.e. total - 1 - elapsed)
  const daysRemaining = Math.max(0, totalDemoDays - daysSinceStart - 1);

  // Expired only after totalDemoDays full days have passed
  const isExpired = daysSinceStart >= totalDemoDays;

  const percentUsed = Math.min(100, Math.round((daysSinceStart / totalDemoDays) * 100));

  return {
    daysRemaining,
    isExpired,
    showWarning: daysRemaining <= 3 && !isExpired,
    percentUsed,
  };
}
