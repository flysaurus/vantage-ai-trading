import { apiPost } from '@/lib/api-client';
// ─── Gamification: Milestones ────────────────────────────────
// Milestone definitions and idempotent award logic.
//
// All DB writes go through server actions (app/actions/gamification.ts).
// This module contains pure logic — milestone definitions, eligibility
// checks, and client-side callers that defer to server actions.

export interface MilestoneDef {
  key: string;
  label: string;
  description: string;
  icon: string;
  /** Points awarded when milestone is earned */
  points: number;
}

// ─── Milestone Registry ──────────────────────────────────────

export const MILESTONE_DEFINITIONS: Record<string, MilestoneDef> = {
  first_login: {
    key: 'first_login',
    label: 'First Login',
    description: 'Opened Vantage for the first time',
    icon: '🚀',
    points: 10,
  },
  first_basket: {
    key: 'first_basket',
    label: 'First Basket',
    description: 'Created your first themed basket',
    icon: '🧺',
    points: 25,
  },
  first_trade: {
    key: 'first_trade',
    label: 'First Trade',
    description: 'Executed your first trade',
    icon: '📈',
    points: 25,
  },
  three_day_streak: {
    key: 'three_day_streak',
    label: '3-Day Streak',
    description: 'Logged in 3 days in a row',
    icon: '🔥',
    points: 30,
  },
  seven_day_streak: {
    key: 'seven_day_streak',
    label: '7-Day Streak',
    description: 'Logged in 7 days in a row',
    icon: '🔥🔥',
    points: 75,
  },
  first_ai_chat: {
    key: 'first_ai_chat',
    label: 'AI Whisperer',
    description: 'Started your first AI conversation',
    icon: '🤖',
    points: 15,
  },
  portfolio_green: {
    key: 'portfolio_green',
    label: 'In the Green',
    description: 'Portfolio value above cost basis',
    icon: '💚',
    points: 50,
  },
  five_baskets: {
    key: 'five_baskets',
    label: 'Basket Collector',
    description: 'Created 5 baskets',
    icon: '🏆',
    points: 60,
  },
  style_master: {
    key: 'style_master',
    label: 'Style Master',
    description: 'Trading consistently with your investor style',
    icon: '🎯',
    points: 100,
  },
};

// ─── Award Logic (Client → Server Action) ────────────────────

/**
 * Check if a milestone has already been awarded (client-side cache check).
 * The actual idempotency guard is in the server action (UNIQUE constraint).
 */
export function isMilestoneAwardedLocally(
  milestoneKey: string,
  awardedLocal: Set<string>
): boolean {
  return awardedLocal.has(milestoneKey);
}

/**
 * Check and award a milestone via server action.
 *
 * This is a client-side helper that calls POST /api/gamification/award-milestone.
 * The server action handles the actual DB write (idempotent via UNIQUE constraint).
 *
 * @returns true if the milestone was newly awarded, false if already earned
 */
export async function checkAndAwardMilestone(
  anonymousId: string,
  milestoneKey: string
): Promise<boolean> {
  if (!MILESTONE_DEFINITIONS[milestoneKey]) {
    console.warn(`[milestones] Unknown milestone: ${milestoneKey}`);
    return false;
  }

  try {
    const res = await apiPost('/api/gamification/award-milestone', { anonymousId, milestoneKey });

    if (!res.ok) {
      // 409 Conflict = already awarded (idempotent)
      if (res.status === 409) return false;
      console.error(`[milestones] Award failed for ${milestoneKey}: ${res.status}`);
      return false;
    }

    const data = await res.json();
    return data.awarded === true;
  } catch (err) {
    console.error(`[milestones] Award error for ${milestoneKey}:`, err);
    return false;
  }
}

/**
 * Fetch all milestones earned by an anonymous user.
 *
 * Calls GET /api/gamification/milestones?anonymousId=xxx
 */
export async function getEarnedMilestones(
  anonymousId: string
): Promise<{ key: string; awarded_at: string }[]> {
  try {
    const res = await fetch(
      `/api/gamification/milestones?anonymousId=${encodeURIComponent(anonymousId)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.milestones || [];
  } catch {
    return [];
  }
}
