// ─── Broker Factory ───────────────────────────────────────────
// Single entry point for getting the active broker engine.
// PortfolioContext calls getBroker() — never imports DemoBroker directly.
//
// CONCURRENCY SAFETY (Phase 7): Each call returns a fresh instance.
// The old global-singleton pattern caused cross-request contamination:
//   - User A's broker could receive User B's request mid-operation
//   - In-memory caches could leak data between users
//   - Race conditions on setUserId() during concurrent requests

import { BrokerEngine } from './types';
import { DemoBroker } from './demo-broker';

// Per-user broker cache (keyed by userId, not a global singleton)
const userBrokers = new Map<string, { broker: BrokerEngine; createdAt: number }>();

// 5-minute TTL on cached broker instances to prevent unbounded growth
const BROKER_CACHE_TTL_MS = 5 * 60 * 1000;

function evictStaleBrokers(): void {
  const now = Date.now();
  for (const [userId, entry] of userBrokers) {
    if (now - entry.createdAt > BROKER_CACHE_TTL_MS) {
      userBrokers.delete(userId);
    }
  }
}

export function getBroker(
  type: string = 'demo',
  userId?: string,
  supabaseClient?: any,
  userEmail?: string,
): BrokerEngine {
  const key = userId || 'anonymous';

  evictStaleBrokers();

  const existing = userBrokers.get(key);
  if (existing && existing.broker.name.toLowerCase() === type.toLowerCase()) {
    existing.createdAt = Date.now(); // Refresh TTL
    return existing.broker;
  }

  // Create a fresh instance — never reuse across users
  const broker = new DemoBroker(userId, supabaseClient, userEmail);
  userBrokers.set(key, { broker, createdAt: Date.now() });

  return broker;
}

export function resetBroker(userId?: string): void {
  if (userId) {
    userBrokers.delete(userId);
  } else {
    userBrokers.clear();
  }
}
