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
  const db = createServerClient() as any;

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
 * Seed a fresh demo portfolio with $100,000 cash and NO positions or orders.
 * Real portfolio content only comes from real trades.
 *
 * Clears existing is_demo data and force-sets demo_portfolio_state
 * + account_snapshots to cash-only ($100K).
 *
 * The DemoBroker.saveState() guardrail protects against accidental overwrites.
 * This function is called on explicit user actions only (start demo, reset, disconnect).
 */
export async function seedDemoPortfolio(
  userId: string,
  style: string,
): Promise<void> {
  const db = supabase();

  // Validate style (input validation only — no fake data used anymore)
  if (!AVAILABLE_STYLES.includes(style)) {
    throw new Error(`Unknown investor style: ${style}. Available: ${AVAILABLE_STYLES.join(', ')}`);
  }

  // Clear existing demo data (positions, orders, briefs, snapshots)
  await clearPortfolio(userId);

  // Update user
  await db
    .from('users')
    .update({
      demo_style: style,
      portfolio_mode: 'demo',
    })
    .eq('id', userId);

  // Seed demo_portfolio_state: $100K cash, empty positions/orders/baskets
  await db
    .from('demo_portfolio_state')
    .upsert(
      {
        user_id: userId,
        positions: [],
        cash_balance: 100_000,
        order_history: [],
        basket_orders: [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  // Seed initial account snapshot with $100K cash-only
  const todayStr = new Date().toISOString();
  await db.from('account_snapshots').upsert({
    user_id: userId,
    equity: 100_000,
    cash: 100_000,
    buying_power: 100_000,
    day_pnl: 0,
    total_pnl: 0,
    positions: [],
    snapshot_at: todayStr,
  }, { onConflict: 'user_id,snapshot_at' });

  console.log('[seedDemoPortfolio] Cash-only demo seeded: $100,000, no positions/orders');
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
