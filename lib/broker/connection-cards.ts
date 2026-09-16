// ─── Connection cards ──────────────────────────────────────────
// Pure grouping used by the Broker Connections page to render ONE card per
// broker connection, each with its own Disconnect.
//
// Why this exists: the page used to ask the service-wide, UNSCONED
// `GET /api/broker/status` for "the" connection. With two connections that
// endpoint correctly refuses to guess (connected + ambiguous, no brokerId), so
// the page rendered no connected card at all and the Disconnect action became
// unreachable. The guard was right; the question was wrong. Connections are now
// enumerated from the same account list the switcher already uses — the
// per-sub-account ids — and every per-connection status read is explicitly
// scoped by connectionId, so the ambiguous branch is never entered.
//
// Invariant preserved: a connection is NEVER represented by the sum of its
// sub-accounts. Each sub-account keeps its own standalone value; a card shows
// rows, not a total. (Same rule the account/positions routes enforce — a single
// Fidelity authorization returns both "Taxable SMA" and "ANIKET - YOUTH", and
// summing them is exactly the leak this workstream fixed.)
//
// Pure + dependency-free so it can be unit-tested without a DOM.

/** Shape of a live (non-demo) row in GET /api/accounts. */
export interface LiveAccountEntry {
  id: string;
  name: string;
  broker?: string;
  brokerageSlug?: string;
  isDemo: boolean;
  tradingEnabled: boolean;
  totalValue: number;
  environment?: 'demo' | 'paper' | 'live';
  /** broker_connections UUID — present on live entries only. */
  connectionId?: string;
  /** SnapTrade sub-account id (3-part id form), when known. */
  snapAccountId?: string;
}

export interface ConnectionCardGroup {
  connectionId: string;
  /** Display name for the card header, e.g. "Fidelity". */
  brokerName: string;
  /** Lower-cased broker slug for logo lookups, when the server sent one. */
  brokerageSlug?: string;
  /** 'paper' | 'live' — taken from the first sub-account (per-connection status may refine it). */
  environment: string | null;
  /** Any sub-account on this connection can trade. */
  tradingEnabled: boolean;
  /** One row per sub-account — standalone values, never summed. */
  subAccounts: { id: string; name: string; totalValue: number }[];
}

/**
 * Group live account entries into one bucket per connection.
 *
 * Rows without a `connectionId` (i.e. the demo portfolio, or a legacy entry the
 * server could not attribute) are skipped — a card without a connection id has
 * nothing safe to disconnect. Order is preserved: first-seen connection wins its
 * position, matching the account switcher's ordering.
 */
export function groupLiveAccountsByConnection(
  entries: readonly LiveAccountEntry[] | null | undefined,
): ConnectionCardGroup[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const byConnection = new Map<string, LiveAccountEntry[]>();
  for (const entry of entries) {
    if (!entry || entry.isDemo) continue;
    const connectionId = entry.connectionId;
    if (!connectionId) continue;
    const bucket = byConnection.get(connectionId);
    if (bucket) bucket.push(entry);
    else byConnection.set(connectionId, [entry]);
  }

  const groups: ConnectionCardGroup[] = [];
  for (const [connectionId, accounts] of byConnection) {
    const first = accounts[0];
    groups.push({
      connectionId,
      brokerName: first?.broker || 'Brokerage',
      brokerageSlug: first?.brokerageSlug,
      environment: first?.environment ?? null,
      tradingEnabled: accounts.some((a) => a.tradingEnabled === true),
      subAccounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        // Each sub-account keeps its OWN value. No reduce/sum here, ever.
        totalValue: a.totalValue,
      })),
    });
  }
  return groups;
}
