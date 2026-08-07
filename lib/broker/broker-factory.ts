// ─── Broker Factory ───────────────────────────────────────────
// Single entry point for getting the active broker engine.
// PortfolioContext calls getBroker() — never imports DemoBroker directly.

import { BrokerEngine } from './types';
import { DemoBroker } from './demo-broker';

let activeBroker: BrokerEngine | null = null;

export function getBroker(
  type: string = 'demo',
  userId?: string,
  supabaseClient?: any,
  userEmail?: string,
): BrokerEngine {
  if (activeBroker) {
    if (activeBroker.name.toLowerCase() !== type.toLowerCase()) {
      activeBroker = null;
    }
  }

  if (!activeBroker) {
    activeBroker = new DemoBroker(userId, supabaseClient, userEmail);
  } else if (activeBroker instanceof DemoBroker) {
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
