// ─── Broker Registry ──────────────────────────────────────────
// Manages broker adapter registration and lookup.
// The app uses `useBroker()` hook — never imports a specific adapter.
//
// Dynamically discovers the active broker from the vault via
// /api/broker/status. Falls back gracefully if no broker is connected.

import type { BrokerAdapter, BrokerId, BrokerRegistry } from '@/types/broker';
import { AlpacaAdapter } from './alpaca';
import { TastytradeAdapter } from './tastytrade';
import { SnapTradeAdapter } from './snaptrade';

class BrokerRegistryImpl implements BrokerRegistry {
  private adapters = new Map<BrokerId, BrokerAdapter>();

  constructor() {
    // Register all available adapters
    this.register(new AlpacaAdapter());
    this.register(new TastytradeAdapter());
    this.register(new SnapTradeAdapter());
  }

  register(adapter: BrokerAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: BrokerId): BrokerAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): BrokerAdapter[] {
    return Array.from(this.adapters.values());
  }
}

// Singleton — one registry for the app
export const brokerRegistry = new BrokerRegistryImpl();

// ─── Active Broker Management ─────────────────────────────────
// The active broker is discovered dynamically from the vault.
// In the client, BrokerProvider calls /api/broker/status on mount
// to determine which broker is connected and initializes it.
//
// The static fallback (getActiveBroker/setActiveBroker) is useful
// for server-side contexts or when the status check hasn't completed.

let _activeId: BrokerId = 'alpaca';

export function getActiveBroker(): BrokerAdapter {
  const broker = brokerRegistry.get(_activeId);
  if (!broker) throw new Error(`Broker not registered: ${_activeId}`);
  return broker;
}

export function setActiveBroker(id: BrokerId): void {
  if (!brokerRegistry.get(id)) throw new Error(`Unknown broker: ${id}`);
  _activeId = id;
}

export function getActiveBrokerId(): BrokerId {
  return _activeId;
}
