// ─── DCA Strategy Scheduler ─────────────────────────────
// Evaluates all active DCA schedules and executes orders.
// Called by cron endpoint. Does NOT place actual orders
// unless a broker is connected — instead it updates the
// schedule's last_run_at / next_run_at and logs the
// intended order.

interface DcaConfig {
  amount: number;
  frequency: string;
  dayOfWeek?: string;
  dayOfMonth?: string;
  startDate: string;
  endDate?: string;
  investBy?: string;
  quantity?: number;
}

interface DcaSchedule {
  id: string;
  user_id: string;
  symbol: string;
  config: DcaConfig;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface DcaExecutionResult {
  scheduleId: string;
  symbol: string;
  userId: string;
  action: 'executed' | 'skipped' | 'error';
  details: string;
  amount?: number;
  shares?: number;
  price?: number;
}

import { decryptData } from '@/lib/crypto';
import { getPrice } from '@/lib/market-data';

// ─── Calculate next run time ─────────────────────────────
export function calculateNextRun(config: DcaConfig, fromDate?: Date): Date {
  const now = fromDate || new Date();
  const base = new Date(now);
  base.setHours(14, 30, 0, 0); // execute at 2:30 PM UTC (10:30 AM ET)

  switch (config.frequency) {
    case 'daily':
      // Next trading day: if after cutoff, move to tomorrow
      if (now.getUTCHours() >= 14 || (now.getUTCHours() === 14 && now.getUTCMinutes() >= 30)) {
        base.setDate(base.getDate() + 1);
      }
      break;

    case 'weekly': {
      const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };
      const targetDay = dayMap[config.dayOfWeek || 'mon'] || 1;
      const currentDay = base.getDay(); // 0=Sun
      const mappedCurrent = currentDay === 0 ? 7 : currentDay;
      let daysUntil = targetDay - mappedCurrent;
      if (daysUntil <= 0) daysUntil += 7;
      base.setDate(base.getDate() + daysUntil);
      break;
    }

    case 'biweekly': {
      const dayMap: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };
      const targetDay = dayMap[config.dayOfWeek || 'mon'] || 1;
      const currentDay = base.getDay();
      const mappedCurrent = currentDay === 0 ? 7 : currentDay;
      let daysUntil = targetDay - mappedCurrent;
      if (daysUntil <= 0) daysUntil += 14; // two weeks forward
      else if (daysUntil < 7) daysUntil += 7; // ensure it's at least a week out
      base.setDate(base.getDate() + daysUntil);
      break;
    }

    case 'monthly': {
      const dayOfMonth = config.dayOfMonth || '1';
      base.setMonth(base.getMonth() + 1);
      base.setDate(1); // start of next month

      if (dayOfMonth === 'last') {
        // Set to last day of month
        base.setMonth(base.getMonth() + 1);
        base.setDate(0); // 0 = last day of previous month
      } else if (dayOfMonth === '15') {
        base.setDate(15);
      } else {
        // '1' or numeric
        const day = parseInt(dayOfMonth) || 1;
        base.setDate(Math.min(day, new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()));
      }
      break;
    }
  }

  return base;
}

// getPrice() now imported from @/lib/market-data (Finnhub → Alpaca → Yahoo fallback)

// ─── Execute all due DCA schedules ────────────────────────
export async function executeDcaSchedules(supabase: any): Promise<DcaExecutionResult[]> {
  const results: DcaExecutionResult[] = [];
  const now = new Date();

  // Fetch active DCA schedules that are due
  const { data: schedules, error } = await supabase
    .from('strategies')
    .select('id, user_id, symbol, config, last_run_at, next_run_at')
    .eq('type', 'dca')
    .eq('is_active', true);

  if (error || !schedules || schedules.length === 0) {
    return results;
  }

  for (const sched of schedules as DcaSchedule[]) {
    try {
      const config = sched.config;
      if (!config?.frequency || !config?.amount) continue;

      // Check if end date has passed
      if (config.endDate) {
        const end = new Date(config.endDate + 'T00:00:00Z');
        if (now > end) {
          // Deactivate expired schedule
          await supabase.from('strategies').update({ is_active: false }).eq('id', sched.id);
          results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'skipped', details: 'Schedule expired (past end date)' });
          continue;
        }
      }

      // Check if start date has arrived
      if (config.startDate) {
        const start = new Date(config.startDate + 'T00:00:00Z');
        if (now < start) {
          results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'skipped', details: 'Not yet started' });
          continue;
        }
      }

      // Check if due based on next_run_at
      if (sched.next_run_at) {
        const nextRun = new Date(sched.next_run_at);
        if (now < nextRun) {
          results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'skipped', details: `Next run: ${nextRun.toISOString()}` });
          continue;
        }
      }

      // Get current price
      const price = await getPrice(sched.symbol);
      if (price == null) {
        results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'error', details: 'Price unavailable' });
        continue;
      }

      // Calculate order details
      let amount = config.amount;
      let shares = 0;
      if (config.investBy === 'shares' && config.quantity) {
        shares = config.quantity;
        amount = shares * price;
      } else {
        shares = amount / price;
      }

      // Place order via Alpaca (if broker connected)
      // For now: log the intended order. The actual broker trade
      // requires reading the user's encrypted Alpaca keys from vault.
      const orderPlaced = await placeDcaOrder(supabase, sched.user_id, sched.symbol, shares, price);

      // Update schedule
      const nextRun = calculateNextRun(config, now);
      await supabase
        .from('strategies')
        .update({
          last_run_at: now.toISOString(),
          next_run_at: nextRun.toISOString(),
        })
        .eq('id', sched.id);

      results.push({
        scheduleId: sched.id,
        symbol: sched.symbol,
        userId: sched.user_id,
        action: orderPlaced ? 'executed' : 'executed',
        details: orderPlaced
          ? `Buy ${shares.toFixed(4)} ${sched.symbol} @ $${price} = $${amount.toFixed(2)}`
          : `Order logged: ${shares.toFixed(4)} ${sched.symbol} @ $${price} (broker not connected)`,
        amount,
        shares,
        price,
      });
    } catch (err: any) {
      results.push({ scheduleId: sched.id, symbol: sched.symbol, userId: sched.user_id, action: 'error', details: err?.message || 'Unknown error' });
    }
  }

  return results;
}

// ─── Place DCA order via broker ──────────────────────────
async function placeDcaOrder(
  supabase: any,
  userId: string,
  symbol: string,
  shares: number,
  price: number,
): Promise<boolean> {
  try {
    // Read Alpaca keys from vault
    // Use supabase (already service client, bypasses RLS)
    const { data: vaultEntry } = await supabase
      .from('broker_vault')
      .select('encrypted_key, encrypted_secret, broker')
      .eq('user_id', userId)
      .eq('broker', 'alpaca')
      .single();

    if (!vaultEntry) return false;

    // Decrypt and place order via Alpaca API
    const apiKey = decryptData(vaultEntry.encrypted_key);
    const apiSecret = decryptData(vaultEntry.encrypted_secret);

    const isPaper = process.env.NEXT_PUBLIC_ALPACA_PAPER === 'true';
    const baseUrl = isPaper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';

    const res = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol,
        qty: String(shares.toFixed(4)),
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        client_order_id: `dca-${userId.slice(0, 8)}-${Date.now()}`,
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}
