// ─── Broker Factory ───────────────────────────────────────────
// Single entry point for getting the active broker engine.
// PortfolioContext calls getBroker() — never imports DemoBroker directly.
//
// Future: getBroker('alpaca', ...) returns AlpacaBroker (Phase 5).
// Today: always returns DemoBroker, using localStorage + Finnhub.

import { BrokerEngine } from './engine';
import { DemoBroker } from './demo-broker';

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
