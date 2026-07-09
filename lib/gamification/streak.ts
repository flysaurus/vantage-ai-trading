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
 * Sends localDate to avoid server-timezone vs user-timezone bugs.
 */
export async function recordDailyOpen(anonymousId: string): Promise<StreakData> {
  const localDate = new Date().toISOString().split('T')[0];
  const res = await apiPost('/api/session/streak', { anonymousId, localDate });

  if (!res.ok) {
    throw new Error(`[streak] recordDailyOpen failed: ${res.status}`);
  }

  const data = await res.json();
  return data.streak as StreakData;
}

/**
 * Fetch streak data from Supabase (read-only).
 */
export async function getStreakData(anonymousId: string): Promise<StreakData | null> {
  const res = await fetch(`/api/session/streak?anonymousId=${encodeURIComponent(anonymousId)}`);

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`[streak] getStreakData failed: ${res.status}`);
  }

  const data = await res.json();
  return data.streak as StreakData | null;
}
