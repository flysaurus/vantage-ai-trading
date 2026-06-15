// ─── Gamification: Streak ────────────────────────────────────
// Client-callable wrappers around the /api/session/streak endpoint.
//
// All DB writes happen server-side (API routes / server actions).
// These functions are safe to call from client components.

import type { StreakData } from '@/lib/session/sync';

/**
 * Record a daily login and return the updated streak.
 *
 * Calls POST /api/session/streak with the anonymous_id.
 * Idempotent — if already synced today, no-op.
 */
export async function recordDailyOpen(anonymousId: string): Promise<StreakData> {
  const res = await fetch('/api/session/streak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anonymousId }),
  });

  if (!res.ok) {
    throw new Error(`[streak] recordDailyOpen failed: ${res.status}`);
  }

  const data = await res.json();
  return data.streak as StreakData;
}

/**
 * Fetch streak data from Supabase (read-only).
 *
 * Uses GET /api/session/streak?anonymousId=xxx
 * Returns null if no streak record exists yet.
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
