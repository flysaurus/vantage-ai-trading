// ─── Portfolio State Sync — Supabase backup for localStorage ──
// localStorage is ephemeral (browser clears, devices don't share).
// Supabase provides cross-device persistence for authenticated users.
// Load order: Supabase → localStorage → seed

import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

interface PortfolioState {
  positions: any[];
  cashBalance: number;
  orderHistory: any[];
  basketPositions: any[];
}

/** Save portfolio state to Supabase (upsert by user_id). */
export async function syncPortfolioToSupabase(
  userId: string,
  state: PortfolioState & { savedAt?: number },
): Promise<boolean> {
  if (!userId) return false;
  try {
    const supabase = getSupabaseBrowserClient();
    // Set auth JWT from session if available (browser context)
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || session.user.id !== userId) return false;

    // Guard: don't overwrite newer server data with stale client state.
    // If the server was updated more recently than our last known save,
    // we reload instead of pushing potentially stale data.
    const clientSavedAt = state.savedAt || 0;
    if (clientSavedAt > 0) {
      const { data: serverRow, error: readErr } = await supabase
        .from('demo_portfolio_state')
        .select('updated_at')
        .eq('user_id', userId)
        .single();

      if (!readErr && serverRow && (serverRow as any).updated_at) {
        const serverUpdatedAt = new Date((serverRow as any).updated_at as string).getTime();
        if (serverUpdatedAt > clientSavedAt) {
          console.log('[Portfolio Sync] Server data is newer — skipping sync, reload needed');
          return false; // caller should reload from server
        }
      }
    }

    const { error } = await (supabase
      .from('demo_portfolio_state') as any)
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
      return false;
    } else {
      console.log('[Portfolio Sync] Saved to Supabase ✅');
      return true;
    }
  } catch (e: any) {
    // localStorage backup already done — safe to swallow
    console.warn('[Portfolio Sync] Supabase error (non-fatal):', e?.message || e);
    return false;
  }
}

/** Load portfolio state from Supabase. Returns null if not found or error. */
export async function loadPortfolioFromSupabase(
  userId: string,
): Promise<(PortfolioState & { savedAt: number }) | null> {
  if (!userId) return null;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || session.user.id !== userId) return null;

    const { data, error } = await supabase
      .from('demo_portfolio_state')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;

    const row = data as Record<string, unknown>;

    return {
      positions: (row.positions as any[]) || [],
      cashBalance: (row.cash_balance as number) ?? 0,
      orderHistory: (row.order_history as any[]) || [],
      basketPositions: (row.basket_positions as any[]) || [],
      savedAt: new Date(row.updated_at as string).getTime(),
    };
  } catch {
    return null;
  }
}
