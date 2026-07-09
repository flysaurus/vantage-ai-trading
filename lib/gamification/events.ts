// ─── Gamification: Events ────────────────────────────────────
// Central event dispatchers for gamification.
// Call these from components when user actions happen.
//
// Each function:
// 1. Calls the relevant server action (via API route or direct server call)
// 2. Checks for milestone eligibility
// 3. Dispatches a DOM event so UI components can react (toasts, badges)
//
// All DB writes are server-side — these are just client dispatchers.

import { checkAndAwardMilestone } from './milestones';
import { apiPost } from '@/lib/api-client';

// ─── Event Bus ────────────────────────────────────────────────

export interface GamificationEvent {
  type: 'milestone_earned' | 'score_updated' | 'streak_updated';
  payload: Record<string, any>;
}

function emitEvent(event: GamificationEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('vantage-gamification', { detail: event })
  );
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Call when a user creates a basket.
 *
 * - Increments baskets_created in investor_scores
 * - Checks: first_basket, five_baskets milestones
 */
export async function onBasketCreated(anonymousId: string): Promise<void> {
  if (!anonymousId) return;

  try {
    // 1. Increment score
    const scoreRes = await apiPost('/api/gamification/increment-baskets', { anonymousId });

    if (scoreRes.ok) {
      const { totalScore } = await scoreRes.json();
      emitEvent({
        type: 'score_updated',
        payload: { totalScore, source: 'basket_created' },
      });
    }

    // 2. Check milestones
    const firstBasket = await checkAndAwardMilestone(anonymousId, 'first_basket');
    if (firstBasket) {
      emitEvent({
        type: 'milestone_earned',
        payload: { milestoneKey: 'first_basket', icon: '🧺' },
      });
    }

    // Check 5 baskets: count baskets_created from score endpoint
    const countRes = await fetch(
      `/api/gamification/score?anonymousId=${encodeURIComponent(anonymousId)}`
    );
    if (countRes.ok) {
      const { score } = await countRes.json();
      if (score?.baskets_created >= 5) {
        const fiveBaskets = await checkAndAwardMilestone(anonymousId, 'five_baskets');
        if (fiveBaskets) {
          emitEvent({
            type: 'milestone_earned',
            payload: { milestoneKey: 'five_baskets', icon: '🏆' },
          });
        }
      }
    }

    // Recalculate score after milestones
    await apiPost('/api/gamification/recalculate', { anonymousId });
  } catch (err) {
    console.error('[gamification/events] onBasketCreated error:', err);
  }
}

/**
 * Call after a trade is executed.
 *
 * - Increments trades_executed in investor_scores
 * - Compares tradeStyle to investor_style for consistency
 * - Checks: first_trade, portfolio_green milestones
 */
export async function onTradeExecuted(
  anonymousId: string,
  tradeStyle?: string,
  investorStyle?: string,
  /** Optional: current portfolio value (for portfolio_green check) */
  portfolioValue?: number,
  /** Optional: total cost basis (for portfolio_green check) */
  portfolioCost?: number
): Promise<void> {
  if (!anonymousId) return;

  try {
    // 1. Increment score with style info
    const scoreRes = await apiPost('/api/gamification/increment-trades', { anonymousId, tradeStyle, investorStyle });

    if (scoreRes.ok) {
      const { totalScore } = await scoreRes.json();
      emitEvent({
        type: 'score_updated',
        payload: { totalScore, source: 'trade_executed' },
      });
    }

    // 2. Check milestones
    const firstTrade = await checkAndAwardMilestone(anonymousId, 'first_trade');
    if (firstTrade) {
      emitEvent({
        type: 'milestone_earned',
        payload: { milestoneKey: 'first_trade', icon: '📈' },
      });
    }

    // Check portfolio_green: portfolio value > cost basis
    if (
      portfolioValue !== undefined &&
      portfolioCost !== undefined &&
      portfolioValue > portfolioCost
    ) {
      const portGreen = await checkAndAwardMilestone(anonymousId, 'portfolio_green');
      if (portGreen) {
        emitEvent({
          type: 'milestone_earned',
          payload: { milestoneKey: 'portfolio_green', icon: '💚' },
        });
      }
    }

    // Check style_master: if tradeStyle matches investorStyle and we've done 5+ trades
    if (tradeStyle && investorStyle && tradeStyle === investorStyle) {
      const countRes = await fetch(
        `/api/gamification/score?anonymousId=${encodeURIComponent(anonymousId)}`
      );
      if (countRes.ok) {
        const { score } = await countRes.json();
        if (score?.trades_executed >= 5) {
          const styleMaster = await checkAndAwardMilestone(anonymousId, 'style_master');
          if (styleMaster) {
            emitEvent({
              type: 'milestone_earned',
              payload: { milestoneKey: 'style_master', icon: '🎯' },
            });
          }
        }
      }
    }

    // Recalculate score
    await apiPost('/api/gamification/recalculate', { anonymousId });
  } catch (err) {
    console.error('[gamification/events] onTradeExecuted error:', err);
  }
}

/**
 * Call when user starts an AI conversation.
 *
 * - Increments ai_sessions in investor_scores
 * - Checks: first_ai_chat milestone
 */
export async function onAISessionStarted(anonymousId: string): Promise<void> {
  if (!anonymousId) return;

  try {
    // 1. Increment score
    const scoreRes = await apiPost('/api/gamification/increment-ai', { anonymousId });

    if (scoreRes.ok) {
      const { totalScore } = await scoreRes.json();
      emitEvent({
        type: 'score_updated',
        payload: { totalScore, source: 'ai_session' },
      });
    }

    // 2. Check milestone
    const firstAIChat = await checkAndAwardMilestone(anonymousId, 'first_ai_chat');
    if (firstAIChat) {
      emitEvent({
        type: 'milestone_earned',
        payload: { milestoneKey: 'first_ai_chat', icon: '🤖' },
      });
    }

    // Recalculate
    await apiPost('/api/gamification/recalculate', { anonymousId });
  } catch (err) {
    console.error('[gamification/events] onAISessionStarted error:', err);
  }
}

/**
 * Call once per day when the user opens the app.
 *
 * - Records daily streak via /api/session/streak
 * - Checks: first_login, three_day_streak, seven_day_streak milestones
 * - Dispatches streak_updated event
 */
export async function onDailyOpen(anonymousId: string): Promise<void> {
  if (!anonymousId) return;

  try {
    // 1. Sync streak (send localDate to avoid server-timezone bugs)
    const localDate = new Date().toISOString().split('T')[0];
    const streakRes = await apiPost('/api/session/streak', { anonymousId, localDate });

    if (!streakRes.ok) return;

    const { streak } = await streakRes.json();

    if (streak) {
      emitEvent({
        type: 'streak_updated',
        payload: {
          currentStreak: streak.current_streak,
          longestStreak: streak.longest_streak,
        },
      });

      // 2. Check first_login milestone (idempotent, safe to call every time)
      const firstLogin = await checkAndAwardMilestone(anonymousId, 'first_login');
      if (firstLogin) {
        emitEvent({
          type: 'milestone_earned',
          payload: { milestoneKey: 'first_login', icon: '🚀' },
        });
      }

      // 3. Check streak milestones
      if (streak.current_streak >= 3) {
        const threeDay = await checkAndAwardMilestone(anonymousId, 'three_day_streak');
        if (threeDay) {
          emitEvent({
            type: 'milestone_earned',
            payload: { milestoneKey: 'three_day_streak', icon: '🔥' },
          });
        }
      }

      if (streak.current_streak >= 7) {
        const sevenDay = await checkAndAwardMilestone(anonymousId, 'seven_day_streak');
        if (sevenDay) {
          emitEvent({
            type: 'milestone_earned',
            payload: { milestoneKey: 'seven_day_streak', icon: '🔥🔥' },
          });
        }
      }

      // Recalculate score (streak bonus changes)
      await apiPost('/api/gamification/recalculate', { anonymousId });
    }
  } catch (err) {
    console.error('[gamification/events] onDailyOpen error:', err);
  }
}
