// ─── Broker Registry ──────────────────────────────────────────
// Manages broker adapter registration and lookup.
// The app uses `useBroker()` hook — never imports a specific adapter.

import type { BrokerAdapter, BrokerId, BrokerRegistry } from '@/types/broker';
import { AlpacaAdapter } from './alpaca';

class BrokerRegistryImpl implements BrokerRegistry {
  private adapters = new Map<BrokerId, BrokerAdapter>();

  constructor() {
    // Register built-in adapters
    this.register(new AlpacaAdapter());
    // Future: this.register(new IBKRAdapter());
    // Future: this.register(new SchwabAdapter());
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

// Convenience: get the currently active broker
// In the future, this reads from user settings/preferences
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
