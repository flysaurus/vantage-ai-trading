// ═══════════════════════════════════════════════════════════════
// lib/broker-connections/origin.ts
// ═══════════════════════════════════════════════════════════════
// Entry-origin plumbing for the Broker Connections surface (/broker-setup).
//
// That screen has more than one real entry point: Settings → "Manage", and the
// "Welcome to Vantage" account picker → "Add a broker". Its Back action used to
// be hardcoded to Settings, so backing out of the picker dumped the user on
// Settings (and, worse, made the picker look like it had been replaced by a
// different screen). Each entry link now carries `?from=<origin>` and Back /
// Cancel route back to the surface the user actually came from — the same
// pattern already used by Tax Loss Harvesting (lib/tax-harvest/origin.ts) and
// the strategy-setup Cancel paths (lib/nav-back.ts).
//
// A cold entry (deep link, OAuth callback redirect, email CTA) has no origin;
// it keeps the historical Settings destination.
//
// Everything here is SSR-safe and never throws.
// ═══════════════════════════════════════════════════════════════

export type BrokerConnOrigin = 'settings' | 'account-picker';

/** Stand-alone route that renders BrokerConnectionsPage. */
export const BROKER_CONNECTIONS_PATH = '/broker-setup';

const ORIGINS: readonly BrokerConnOrigin[] = ['settings', 'account-picker'];

/** Entry link for a given origin: `/broker-setup?from=<origin>`. */
export function brokerConnectionsPath(origin: BrokerConnOrigin): string {
  return `${BROKER_CONNECTIONS_PATH}?from=${origin}`;
}

/** Validate a raw `?from=` value. Junk (or missing) → null = cold entry. */
export function parseBrokerConnOrigin(
  value: string | null | undefined,
): BrokerConnOrigin | null {
  if (!value) return null;
  return (ORIGINS as readonly string[]).includes(value)
    ? (value as BrokerConnOrigin)
    : null;
}

/**
 * Where Back / Cancel must return for a given origin.
 * `account-picker` re-opens the picker overlay via `?account-select=true`
 * (that path is honoured regardless of the one-per-session suppression key).
 * A cold entry keeps the previous Settings destination.
 */
export function brokerConnectionsBackPath(origin: BrokerConnOrigin | null): string {
  switch (origin) {
    case 'account-picker':
      return '/?account-select=true';
    case 'settings':
    default:
      return '/?tab=settings';
  }
}
