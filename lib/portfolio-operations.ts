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
 * Delete ALL portfolio data for a user: positions, orders, daily briefs,
 * weekly snapshots. Does NOT touch user profile settings.
 */
export async function clearPortfolio(userId: string): Promise<void> {
  const db = supabase();
  await Promise.all([
    db.from('positions').delete().eq('user_id', userId),
    db.from('orders').delete().eq('user_id', userId),
    db.from('daily_briefs').delete().eq('user_id', userId),
    db.from('weekly_snapshots').delete().eq('user_id', userId),
  ]);
}

// ─── seedDemoPortfolio ───────────────────────────────────────

/**
 * Clear existing portfolio then seed with a specific investor style's
 * demo data. All records get is_demo = true.
 * Updates user's demo_style + portfolio_mode in the users table.
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
          buyDate: new Date().toISOString(),
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
  positions: Array<{ symbol: string; qty: number; avgCost: number; name?: string; sector?: string }>,
  cashBalance: number,
) {
  try {
    const daysToBackfill = 90;
    const snapshotRows: Array<{
      user_id: string;
      equity: number;
      cash: number;
      buying_power: number;
      day_pnl: number;
      total_pnl: number;
      positions: any;
      snapshot_at: string;
    }> = [];

    // Deterministic seeded random from user ID
    const seedValue = userId.split('-')[0];
    const seedNum = parseInt(seedValue, 16) || 12345;

    function seededRandom(seed: number): number {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }

    let runningValue = 100000;
    const today = new Date();

    for (let i = daysToBackfill; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      // Skip weekends
      const day = date.getDay();
      if (day === 0 || day === 6) continue;

      // Deterministic small daily variance
      const dayVariance = (seededRandom(seedNum + i) - 0.48) * 0.008;
      runningValue = runningValue * (1 + dayVariance);

      // Clamp to reasonable range
      runningValue = Math.max(85000, Math.min(115000, runningValue));

      snapshotRows.push({
        user_id: userId,
        equity: Math.round(runningValue * 100) / 100,
        cash: cashBalance,
        buying_power: cashBalance,
        day_pnl: 0,
        total_pnl: Math.round((runningValue - 100000) * 100) / 100,
        positions: positions.map((p) => ({
          symbol: p.symbol,
          qty: p.qty,
          avgCost: p.avgCost,
          name: p.name,
          sector: p.sector,
        })),
        snapshot_at: date.toISOString(),
      });
    }

    // Pin last entry to exactly $100,000 (today's seed value)
    if (snapshotRows.length > 0) {
      snapshotRows[snapshotRows.length - 1] = {
        ...snapshotRows[snapshotRows.length - 1],
        equity: 100000,
        total_pnl: 0,
        snapshot_at: today.toISOString(),
      };
    }

    if (snapshotRows.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < snapshotRows.length; i += batchSize) {
        const batch = snapshotRows.slice(i, i + batchSize);
        const { error } = await db.from('account_snapshots').upsert(batch as any, {
          onConflict: 'user_id,snapshot_at',
        });
        if (error) {
          console.error('[seed] historical snapshot batch insert error:', error.message);
        }
      }
      console.log(`[seed] backfilled ${snapshotRows.length} historical snapshots`);
    }
  } catch (err: any) {
    console.error('[seed] historical snapshot error:', err?.message || err);
    // Non-fatal
  }
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
  const db = supabase();

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
