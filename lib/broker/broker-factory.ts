// ─── Broker Factory ───────────────────────────────────────────
// Single entry point for getting the active broker engine.
// PortfolioContext calls getBroker() — never imports DemoBroker directly.
//
// Future: getBroker('alpaca', ...) returns AlpacaBroker (Phase 5).
// Today: always returns DemoBroker, using localStorage + Finnhub.

import { BrokerEngine } from './engine';
import { DemoBroker } from './demo-broker';
import { SnapTradeBroker } from './snaptrade-broker';
import { getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';

let activeBroker: BrokerEngine | null = null;

export function getBroker(
  type: string = 'demo',
  userId?: string,
  supabaseClient?: any,
  userEmail?: string,
): BrokerEngine {
  if (activeBroker) {
    // If broker type changed, reset
    if (activeBroker.name.toLowerCase() !== type.toLowerCase()) {
      activeBroker = null;
    }
  }

  if (!activeBroker) {
    activeBroker = new DemoBroker(userId, supabaseClient, userEmail);
  } else if (activeBroker instanceof DemoBroker) {
    // Update context on cached broker — user/auth may not have been
    // available when broker was first created (e.g. auth still loading)
    if (userId && userId !== 'demo_user') {
      (activeBroker as DemoBroker).setUserId(userId);
    }
    if (supabaseClient) {
      (activeBroker as DemoBroker).setSupabase(supabaseClient);
    }
    if (userEmail) {
      (activeBroker as DemoBroker).setUserEmail(userEmail);
    }
  }

  return activeBroker;
}

export function resetBroker(): void {
  activeBroker = null;
}

// ── Async factory — for PortfolioContext ─────────────────────

interface AsyncBrokerResult {
  broker: BrokerEngine;
  brokerSource: 'demo' | 'snaptrade';
}

/**
 * Resolve the active broker asynchronously by checking broker_connections.
 * Returns a SnapTradeBroker if a connected SnapTrade brokerage exists,
 * otherwise falls back to DemoBroker.
 *
 * Fully generic — works with ANY SnapTrade-connected brokerage.
 */
export async function getBrokerAsync(
  userId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
  userEmail?: string,
): Promise<AsyncBrokerResult> {
  // Dynamically import supabase to avoid client-side bundling
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check for active SnapTrade connection
  const { data: conn } = await supabase
    .from('broker_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('connection_type', 'snaptrade')
    .eq('status', 'connected')
    .maybeSingle();

  if (
    conn?.snaptrade_user_id &&
    conn?.snaptrade_user_secret_encrypted &&
    conn?.snaptrade_connection_id
  ) {
    try {
      const snapUser = await getOrCreateSnapTradeUser(
        userId,
        conn.snaptrade_user_id,
        conn.snaptrade_user_secret_encrypted,
      );

      const broker = new SnapTradeBroker({
        userId: snapUser.userId,
        userSecret: snapUser.userSecret,
        connectionId: conn.snaptrade_connection_id,
        brokerSlug: conn.brokerage_slug || 'UNKNOWN',
        brokerName: formatBrokerName(conn.brokerage_slug),
        tradingEnabled: conn.trading_enabled ?? false,
      });

      console.error('[broker-factory] Using SnapTradeBroker for', conn.brokerage_slug);
      return { broker, brokerSource: 'snaptrade' };
    } catch (err) {
      console.error('[broker-factory] SnapTrade init failed, falling back to Demo:', err);
    }
  }

  // Fallback to DemoBroker
  console.error('[broker-factory] No SnapTrade connection, using DemoBroker');
  const demo = new DemoBroker(userId, supabase, userEmail);
  return { broker: demo, brokerSource: 'demo' };
}

function formatBrokerName(slug: string | null): string {
  if (!slug) return 'Unknown';
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
