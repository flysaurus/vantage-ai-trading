import { apiPost } from '@/lib/api-client';
// ─── Gamification: Streak ────────────────────────────────────
// Client-callable wrappers around the /api/session/streak endpoint.
// (Streak tracking via authenticated user ID — anonymous sessions removed.)

export interface StreakData {
  current_streak: number;
  longest_streak: number;
  last_open_date: string;
  total_days_active: number;
}

/**
 * Record a daily login and return the updated streak.
 * Uses user_id now (was anonymous_id pre-cleanup).
 */
export async function recordDailyOpen(userId: string): Promise<StreakData> {
  const res = await await apiPost('/api/session/streak', JSON.stringify({ userId }));

  if (!res.ok) {
    throw new Error(`[streak] recordDailyOpen failed: ${res.status}`);
  }

  const data = await res.json();
  return data.streak as StreakData;
}

/**
 * Fetch streak data from Supabase (read-only).
 */
export async function getStreakData(userId: string): Promise<StreakData | null> {
  const res = await fetch(`/api/session/streak?userId=${encodeURIComponent(userId)}`);

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`[streak] getStreakData failed: ${res.status}`);
  }

  const data = await res.json();
  return data.streak as StreakData | null;
}
