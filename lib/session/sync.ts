// ─── Anonymous Session Sync ──────────────────────────────────
// Server-side utilities for syncing anonymous session data to
// Supabase. These run as API routes or server actions — NEVER
// import these in client components directly.
//
// Tables:
//   anonymous_profiles  — profile data keyed by anonymous_id
//   streaks             — daily login streak tracking
//
// Both tables use anonymous_id as the primary key before auth.
// After magic link migration, data is moved to the authenticated
// user's tables (008_magic_link_auth.sql RPC).

import { createServerClient } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────

export interface AnonymousProfile {
  anonymous_id: string;
  first_name?: string;
  investor_style?: string;
  risk_tolerance?: string;
  first_open: string;
  last_active: string;
}

export interface StreakData {
  id?: string;
  anonymous_id: string;
  current_streak: number;
  longest_streak: number;
  last_open_date: string; // YYYY-MM-DD
  total_opens: number;
  created_at: string;
  updated_at: string;
}

// ─── Profile Sync ────────────────────────────────────────────

/**
 * Upsert anonymous profile to Supabase.
 *
 * Called periodically by the client to keep anonymous session
 * data synced to the server. Uses anonymous_id as the unique key —
 * no user_id yet (user hasn't authenticated).
 *
 * The first_open timestamp from localStorage takes precedence
 * (it's set once on first visit). Server timestamp is only used
 * if no localStorage value exists.
 */
export async function syncAnonymousProfile(
  anonymousId: string,
  profile: Partial<Pick<AnonymousProfile, 'first_name' | 'investor_style' | 'risk_tolerance'>>
): Promise<void> {
  if (!anonymousId) {
    console.warn('[sync] No anonymous ID — skipping profile sync');
    return;
  }

  try {
    const supabase = createServerClient();
    const now = new Date().toISOString();

    const { error } = await (supabase as any)
      .from('anonymous_profiles')
      .upsert({
        anonymous_id: anonymousId,
        first_name: profile.first_name || null,
        investor_style: profile.investor_style || null,
        risk_tolerance: profile.risk_tolerance || null,
        last_active: now,
      }, {
        onConflict: 'anonymous_id',
      });

    if (error) {
      console.error('[sync] Profile sync failed:', error.message);
    } else {
      console.log('[sync] Profile synced for:', anonymousId.slice(0, 8) + '...');
    }
  } catch (err: any) {
    console.error('[sync] Profile sync error:', err.message);
  }
}

// ─── Streak Sync ─────────────────────────────────────────────

/**
 * Sync the daily login streak for an anonymous user.
 *
 * Logic:
 * - If last_open_date = today: return existing streak (no change)
 * - If last_open_date = yesterday: increment streak +1
 * - If last_open_date = older or null: reset streak to 1
 * - longest_streak tracks the all-time best
 *
 * Returns the updated streak data.
 */
export async function syncStreak(anonymousId: string): Promise<StreakData> {
  if (!anonymousId) {
    throw new Error('Anonymous ID is required for streak sync');
  }

  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const now = new Date().toISOString();

  try {
    // Fetch existing streak record
    const { data: existing, error: fetchError } = await (supabase as any)
      .from('streaks')
      .select('*')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (fetchError) {
      console.error('[sync] Streak fetch error:', fetchError.message);
    }

    // If no existing record, create one
    if (!existing) {
      const newStreak: StreakData = {
        anonymous_id: anonymousId,
        current_streak: 1,
        longest_streak: 1,
        last_open_date: today,
        total_opens: 1,
        created_at: now,
        updated_at: now,
      };

      const { error: insertError } = await (supabase as any)
        .from('streaks')
        .insert(newStreak);

      if (insertError) {
        console.error('[sync] Streak insert error:', insertError.message);
      } else {
        console.log('[sync] New streak started for:', anonymousId.slice(0, 8) + '...');
      }

      return newStreak;
    }

    // Existing record — check if we need to update
    const lastDate = existing.last_open_date;
    let currentStreak = existing.current_streak;
    let longestStreak = existing.longest_streak;

    if (lastDate === today) {
      // Already opened today — no change
      console.log('[sync] Streak unchanged:', currentStreak, 'days');
      return existing as StreakData;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (lastDate === yesterdayStr) {
      // Consecutive day — increment
      currentStreak += 1;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
      }
      console.log('[sync] Streak incremented to:', currentStreak, 'days');
    } else {
      // Missed a day — reset
      currentStreak = 1;
      console.log('[sync] Streak reset — missed day(s)');
    }

    const updated: Partial<StreakData> = {
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_open_date: today,
      total_opens: (existing.total_opens || 0) + 1,
      updated_at: now,
    };

    const { error: updateError } = await (supabase as any)
      .from('streaks')
      .update(updated)
      .eq('anonymous_id', anonymousId);

    if (updateError) {
      console.error('[sync] Streak update error:', updateError.message);
    }

    return { ...existing, ...updated } as StreakData;
  } catch (err: any) {
    console.error('[sync] Streak sync error:', err.message);

    // Return a fallback — client can still function
    return {
      anonymous_id: anonymousId,
      current_streak: 0,
      longest_streak: 0,
      last_open_date: today,
      total_opens: 0,
      created_at: now,
      updated_at: now,
    };
  }
}
