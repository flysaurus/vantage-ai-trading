// ─── Trading Capability ──────────────────────────────────────
// Single source of truth for whether a given account can actually place
// orders. Derived from account metadata only — never from a hardcoded
// broker-name allowlist.
//
//   'full'      → orders may be placed (demo, paper, or a trade-enabled live
//                 broker connection).
//   'read_only' → the account is a live broker connection that is read-only
//                 (connection.type === 'read' OR brokerage.allows_trading is
//                 false). Order placement is blocked; the UI must surface a
//                 friendly "re-authorize with trading access" state.
//
// Demo accounts are ALWAYS 'full' — demo trading never touches real money and
// is intentionally allowed regardless of any live connection's capability.

export type TradingCapability = 'full' | 'read_only';

export interface TradingCapabilityInput {
  /** True when the active account is the demo portfolio. */
  isDemo: boolean;
  /** The account's trading-enabled flag (authoritative server-side value). */
  tradingEnabled: boolean;
}

/** Derive the trading capability from account metadata. */
export function deriveTradingCapability(input: TradingCapabilityInput): TradingCapability {
  return !input.isDemo && !input.tradingEnabled ? 'read_only' : 'full';
}

/** True when the capability forbids order placement. */
export function isReadOnlyCapability(capability: TradingCapability): boolean {
  return capability === 'read_only';
}

/** Human-readable reason for a read-only account (used in disabled states). */
export function readOnlyReason(brokerDisplayName?: string): string {
  const name = brokerDisplayName?.trim() || 'This broker';
  return `${name} is read-only — re-authorize with trading access to place orders.`;
}
