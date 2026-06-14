// ─── Portfolio State Sync — Supabase backup for localStorage ──
// localStorage is ephemeral (browser clears, devices don't share).
// Supabase provides cross-device persistence for authenticated users.
// Load order: Supabase → localStorage → seed

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

interface PortfolioState {
  positions: any[];
  cashBalance: number;
  orderHistory: any[];
  basketPositions: any[];
}

/** Save portfolio state to Supabase (upsert by user_id). */
export async function syncPortfolioToSupabase(
  userId: string,
  state: PortfolioState,
): Promise<void> {
  if (!userId || !SUPABASE_URL) return;
  try {
    const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    // Set auth JWT from session if available (browser context)
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || session.user.id !== userId) return;

    const { error } = await supabase
      .from('demo_portfolio_state')
      .upsert(
        {
          user_id: userId,
          positions: state.positions,
          cash_balance: state.cashBalance,
          order_history: state.orderHistory,
          basket_positions: state.basketPositions,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (error) {
      console.warn('[Portfolio Sync] Supabase upsert failed:', error.message);
    } else {
      console.log('[Portfolio Sync] Saved to Supabase ✅');
    }
  } catch (e: any) {
    // localStorage backup already done — safe to swallow
    console.warn('[Portfolio Sync] Supabase error (non-fatal):', e?.message || e);
  }
}

/** Load portfolio state from Supabase. Returns null if not found or error. */
export async function loadPortfolioFromSupabase(
  userId: string,
): Promise<(PortfolioState & { savedAt: number }) | null> {
  if (!userId || !SUPABASE_URL) return null;
  try {
    const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || session.user.id !== userId) return null;

    const { data, error } = await supabase
      .from('demo_portfolio_state')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;

    return {
      positions: data.positions || [],
      cashBalance: data.cash_balance ?? 65005,
      orderHistory: data.order_history || [],
      basketPositions: data.basket_positions || [],
      savedAt: new Date(data.updated_at).getTime(),
    };
  } catch {
    return null;
  }
}
