/**
 * Portfolio Operations — master portfolio state management.
 *
 * ALL portfolio state transitions (demo ↔ live, style switching, seeding)
 * go through this file. No other file directly mutates positions/orders
 * for portfolio mode changes.
 *
 * Uses createServerClient() (service_role) to bypass RLS.
 * SERVER-SIDE ONLY. Never import in client components.
 */

import { createServerClient } from '@/lib/supabase';
import {
  DEMO_PORTFOLIOS,
  getDemoPortfolio,
  getDemoOrders,
} from '@/lib/demo-data';
import type { InvestorStyle } from '@/types';


// ─── Style metadata ──────────────────────────────────────────

const DEMO_STYLE_NAMES: Record<string, string> = {
  buffett: 'Warren Buffett · Value Hunter',
  lynch: 'Peter Lynch · Growth Chaser',
  livermore: 'Jesse Livermore · Momentum Rider',
  munger: 'Charlie Munger · Dividend Compounder',
  soros: 'George Soros · Macro Strategist',
};

export const AVAILABLE_STYLES = Object.keys(DEMO_STYLE_NAMES);

export function getDemoStyleName(style: string): string {
  return DEMO_STYLE_NAMES[style] ?? 'Demo Portfolio';
}

// ─── Helpers ─────────────────────────────────────────────────

function supabase() {
  return createServerClient() as any;
}

// ─── clearPortfolio ──────────────────────────────────────────

/**
 * Delete ONLY demo portfolio data for a user: positions, orders,
 * daily briefs, weekly snapshots.
 *
 * ⚠️ CRITICAL: FILTERED to `is_demo = true` — this must NEVER touch live
 * broker data. Live positions and live orders are preserved.
 *
 * Does NOT touch user profile settings or demo_portfolio_state.
 */
export async function clearPortfolio(userId: string): Promise<void> {
  const db = supabase();
  await Promise.all([
    db.from('positions').delete().eq('user_id', userId).eq('is_demo', true),
    db.from('orders').delete().eq('user_id', userId).eq('is_demo', true),
    db.from('daily_briefs').delete().eq('user_id', userId),
    db.from('weekly_snapshots').delete().eq('user_id', userId),
  ]);
}

// ─── activateLivePortfolio ──────────────────────────────────

/**
 * Switch from demo to live: clear all demo data, insert real broker
 * positions and orders with is_demo = false.
 * Updates user's portfolio_mode to 'live'.
 */
export async function activateLivePortfolio(
  userId: string,
  brokerPositions: Array<{
    symbol: string;
    qty: number;
    avg_cost?: number;
    current_price?: number;
    market_value?: number;
    unrealized_pnl?: number;
    unrealized_pnl_pct?: number;
    sector?: string | null;
    industry?: string | null;
    name?: string;
  }>,
  brokerOrders: Array<{
    symbol: string;
    qty: number;
    filled_qty?: number;
    side: string;
    order_type?: string;
    status: string;
    filled_price?: number;
    filled_at?: string;
    time_in_force?: string;
  }>,
): Promise<void> {
  const db = createServerClient();

  // Clear existing (demo or stale live)
  await clearPortfolio(userId);

  // Insert live positions
  const positionRows = brokerPositions.map((p) => ({
    user_id: userId,
    symbol: p.symbol,
    qty: p.qty,
    avg_cost: p.avg_cost ?? null,
    current_price: p.current_price ?? null,
    market_value: p.market_value ?? null,
    unrealized_pnl: p.unrealized_pnl ?? null,
    unrealized_pnl_pct: p.unrealized_pnl_pct ?? null,
    sector: p.sector ?? null,
    industry: p.industry ?? null,
    name: p.name ?? null,
    is_demo: false,
  }));

  if (positionRows.length > 0) {
    await db.from('positions').insert(positionRows);
  }

  // Insert live orders
  const orderRows = brokerOrders.map((o) => ({
    user_id: userId,
    symbol: o.symbol,
    qty: o.qty,
    filled_qty: o.filled_qty ?? o.qty,
    side: o.side,
    order_type: o.order_type || 'market',
    status: o.status,
    filled_price: o.filled_price ?? null,
    filled_at: o.filled_at ?? new Date().toISOString(),
    time_in_force: o.time_in_force || 'day',
    is_demo: false,
  }));

  if (orderRows.length > 0) {
    await db.from('orders').insert(orderRows);
  }

  // Update user
  await db
    .from('users')
    .update({
      portfolio_mode: 'live',
    })
    .eq('id', userId);
}

// ─── seedDemoPortfolio ───────────────────────────────────────

/**
 * Clear existing demo portfolio then seed with a specific investor style's
 * demo data. All records get is_demo = true.
 * Updates user's demo_style + portfolio_mode in the users table.
 *
 * ⚠️ CRITICAL: Only clears is_demo=true data via clearPortfolio().
 * Live broker positions/orders are NEVER touched by this function.
 *
 * ⚠️ This is a DESTRUCTIVE reset of demo state — only call on first
 * activation or explicit user/admin reset. Never call from onboarding
 * or style-change flows.
 */
export async function seedDemoPortfolio(
  userId: string,
  style: string,
): Promise<void> {
  const db = supabase();

  // Validate style
  const portfolio = DEMO_PORTFOLIOS[style as InvestorStyle];
  if (!portfolio) {
    throw new Error(`Unknown investor style: ${style}`);
  }

  // Clear existing
  await clearPortfolio(userId);

  // Insert positions
  const positionRows = portfolio.positions.map((p) => ({
    user_id: userId,
    symbol: p.symbol,
    qty: p.qty,
    avg_cost: p.avgCost,
    sector: p.sector,
    industry: p.industry || null,
    name: p.name,
    is_demo: true,
    buy_date: p.buyDate || null,
  }));

  if (positionRows.length > 0) {
    await db.from('positions').insert(positionRows);
  }

  // Insert orders
  const demoOrders = getDemoOrders(style as InvestorStyle);
  const orderRows = demoOrders.map((o) => ({
    user_id: userId,
    symbol: o.symbol,
    qty: o.qty,
    filled_qty: o.filledQty ?? o.qty,
    side: o.side,
    order_type: o.type,
    status: o.status,
    filled_price: o.filledPrice,
    filled_at: o.createdAt,
    time_in_force: o.timeInForce,
    is_demo: true,
  }));

  if (orderRows.length > 0) {
    await db.from('orders').insert(orderRows);
  }

  // Update user
  await db
    .from('users')
    .update({
      demo_style: style,
      portfolio_mode: 'demo',
    })
    .eq('id', userId);

  // Sync demo_portfolio_state with correct cash = $100K - invested
  const totalInvested = portfolio.positions.reduce(
    (sum, p) => sum + p.qty * p.avgCost,
    0,
  );
  const cashBalance = Math.max(0, 100000 - totalInvested);

  // ⚠️ NEVER blindly overwrite existing portfolio data.
  // Check if the user already has positions, orders, or basket orders —
  // if so, skip seeding entirely. This prevents reset/disconnect/mount-race
  // from wiping real user data back to seed defaults.
  const existing = await db
    .from('demo_portfolio_state')
    .select('positions, basket_orders')
    .eq('user_id', userId)
    .maybeSingle();

  const hasExistingPositions = existing && Array.isArray(existing.positions) && existing.positions.length > 0;
  const hasExistingBasketOrders = existing && Array.isArray(existing.basket_orders) && existing.basket_orders.length > 0;

  if (hasExistingPositions || hasExistingBasketOrders) {
    console.log('[seedDemoPortfolio] User already has data — skipping seed to prevent data loss');
    return;
  }

  await db
    .from('demo_portfolio_state')
    .upsert(
      {
        user_id: userId,
        positions: positionRows.map((p: any) => ({
          symbol: p.symbol,
          qty: Number(p.qty),
          avgCost: Number(p.avg_cost),
          name: p.name,
          sector: p.sector,
          buyDate: p.buy_date || new Date().toISOString(),
        })),
        cash_balance: cashBalance,
        orders: [],
        basket_orders: [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  // Seed initial account snapshot for portfolio chart
  const todayStr = new Date().toISOString();
  await db.from('account_snapshots').upsert({
    user_id: userId,
    equity: 100000,
    cash: cashBalance,
    buying_power: cashBalance,
    day_pnl: 0,
    total_pnl: 0,
    positions: portfolio.positions.map((p) => ({
      symbol: p.symbol,
      qty: p.qty,
      avgCost: p.avgCost,
      name: p.name,
      sector: p.sector,
    })),
    snapshot_at: todayStr,
  }, { onConflict: 'user_id,snapshot_at' });

  console.log('[seed] account snapshot created');

  // Seed historical snapshots for chart (YTD backfill)
  await seedHistoricalSnapshots(db, userId, portfolio.positions, cashBalance);
}

// ─── seedHistoricalSnapshots ────────────────────────────────

async function seedHistoricalSnapshots(
  db: ReturnType<typeof createServerClient>,
  userId: string,
  positions: Array<{ symbol: string; qty: number; avgCost: number; name?: string; sector?: string; buyDate?: string }>,
  cashBalance: number,
) {
  try {
    // Find earliest buy date — start backfill from there
    const buyDates = positions.map(p => p.buyDate ? new Date(p.buyDate).getTime() : 0);
    const earliestMs = Math.min(...buyDates);
    if (earliestMs === 0 || earliestMs >= Date.now()) {
      console.log('[seed] no valid buyDates on positions, skipping buyDate-aware backfill');
      return;
    }

    const snapshotRows: Array<{
      user_id: string;
      date: string;
      equity: number;
      cash: number;
      market_value: number;
      day_pnl: number;
      day_pnl_pct: number;
      total_pnl: number;
      total_pnl_pct: number;
      created_at: string;
    }> = [];

    const seedValue = userId.split('-')[0];
    const seedNum = parseInt(seedValue, 16) || 12345;

    function seededRandom(seed: number): number {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }

    let dayIndex = 0;
    const userStartDate = new Date(earliestMs);
    const today = new Date();
    const cursor = new Date(userStartDate);

    while (cursor <= today) {
      const d = cursor.getDay();
      if (d !== 0 && d !== 6) {
        const dateStr = cursor.toISOString().split('T')[0];

        // Only include positions purchased on or before this date
        const heldPositions = positions.filter(
          p => p.buyDate ? new Date(p.buyDate).getTime() <= cursor.getTime() : true,
        );
        const costBasisToDate = heldPositions.reduce(
          (sum, p) => sum + p.qty * p.avgCost, 0,
        );
        const cashOnDate = Math.max(0, 100000 - costBasisToDate);

        // Synthetic variance — ramps up as time passes
        const variance = (seededRandom(seedNum + dayIndex) - 0.48) * 0.006;
        const growthFactor = 1 + variance * Math.min(dayIndex / 30, 1);
        const marketValueOnDate = heldPositions.length > 0
          ? costBasisToDate * growthFactor
          : 0;
        const equityOnDate = cashOnDate + Math.max(0, marketValueOnDate);

        snapshotRows.push({
          user_id: userId,
          date: dateStr,
          equity: Math.round(equityOnDate * 100) / 100,
          cash: Math.round(cashOnDate * 100) / 100,
          market_value: Math.round(Math.max(0, marketValueOnDate) * 100) / 100,
          day_pnl: 0, day_pnl_pct: 0,
          total_pnl: Math.round((equityOnDate - 100000) * 100) / 100,
          total_pnl_pct: Math.round(((equityOnDate - 100000) / 100000) * 10000) / 100,
          created_at: cursor.toISOString(),
        });
        dayIndex++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (snapshotRows.length > 0) {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < snapshotRows.length; i += CHUNK_SIZE) {
        await db.from('account_snapshots')
          .upsert(snapshotRows.slice(i, i + CHUNK_SIZE), { onConflict: 'user_id,date' });
      }
      console.log('[seed] backfilled', snapshotRows.length, 'snapshots from', userStartDate.toISOString().split('T')[0]);
    }
  } catch (err: any) {
    console.error('[seed] historical snapshot error:', err?.message || err);
    // Non-fatal
  }
}

// ─── switchDemoStyle ─────────────────────────────────────────

/**
 * Switch the user's demo portfolio to a different investor style.
 * Clears existing demo data and seeds the new style.
 */
export async function switchDemoStyle(
  userId: string,
  newStyle: string,
): Promise<void> {
  if (!AVAILABLE_STYLES.includes(newStyle)) {
    throw new Error(
      `Invalid style "${newStyle}". Available: ${AVAILABLE_STYLES.join(', ')}`,
    );
  }
  await seedDemoPortfolio(userId, newStyle);
}
