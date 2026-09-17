// ─── Account enumeration for GET /api/accounts ────────────────
//
// WHICH accounts does a connection expose? Two possible sources:
//
//   1. `broker_accounts` — the per-row registry from Part B step 2. This is
//      ENUMERATION (a row exists because a sub-account was actually seen and
//      registered), so when rows exist they are authoritative: we never add an
//      account the registry does not know about.
//   2. The legacy connection-level `snaptrade_accounts` JSONB snapshot (plus
//      the live SnapTrade list). Kept ONLY for connections with no registry
//      rows yet — i.e. the 0–1-account case, where connection-level scope was
//      never ambiguous.
//
// Values are a separate axis from enumeration. A registry row says *which*
// account exists; it does not carry balances. So the value for each account
// comes from, in order: the live sub-account with the same SnapTrade id, then
// the snapshot entry with the same id. If neither has a usable number the
// value is `null` — unknown — and the UI must print a dash, never a 0.
//
// ⚠️ A snapshot `totalValue` of 0 is treated as UNKNOWN: the step-2 backfill
// captured `totalValue: 0` for accounts that are demonstrably not empty (the
// Fidelity SMA reads $377k live), so a zero there is an artifact, not a fact.
// Reading cash as 0 or a value as 0 would fabricate a balance.

export interface RegisteredAccountRow {
  id: string;
  connection_id: string;
  snaptrade_account_id: string | null;
  name: string | null;
  status?: string | null;
}

export interface LiveSubAccount {
  id: string | null;
  name: string;
  totalValue?: number | null;
  cash?: number | null;
  buyingPower?: number | null;
}

export interface LegacySnapAccount {
  id?: string | null;
  name?: string | null;
  totalValue?: number | null;
  total_value?: number | null;
  cash?: number | null;
  buyingPower?: number | null;
  buying_power?: number | null;
}

export type ValueSource = 'live' | 'snapshot' | 'unknown';

export interface EnumeratedAccount {
  /** SnapTrade sub-account id, or null for a connection-level entry. */
  snapAccountId: string | null;
  /** `broker_accounts.id` when the registry listed this account. */
  brokerAccountId: string | null;
  name: string;
  totalValue: number | null;
  cash: number | null;
  buyingPower: number | null;
  valueSource: ValueSource;
}

/** A snapshot number is only believable when it is a real, non-zero number. */
function believableOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null;
}

/**
 * Values from the connect-time snapshot (`broker_connections.snaptrade_accounts`).
 *
 * ⚠️ The snapshot is written ONCE at connect time and never refreshed, so its
 * CASH is a connect-time artifact — it is NOT current cash and must never be
 * presented as a balance (this is the class of bug behind the "$100,865 cash
 * idle" card; see 0f55682 / lib/broker/live-account-cash.ts). Cash and buying
 * power are therefore dropped here. A snapshot TOTAL is still surfaced, but only
 * when believable, and it is labelled `valueSource: 'snapshot'`.
 */
function snapshotValues(s: LegacySnapAccount): { totalValue: number | null; cash: number | null; buyingPower: number | null } {
  return {
    totalValue: believableOrNull(s.totalValue ?? s.total_value),
    cash: null,
    buyingPower: null,
  };
}

export function enumerateConnectionAccounts(input: {
  registered: readonly RegisteredAccountRow[];
  live: readonly LiveSubAccount[] | null | undefined;
  snapshot: readonly LegacySnapAccount[];
  brokerName: string;
}): EnumeratedAccount[] {
  const { live, snapshot, brokerName } = input;
  const registered = (input.registered ?? []).filter((r) => (r.status ?? 'open') !== 'closed');

  // ── Registry-first: rows exist → they ARE the enumeration ──
  if (registered.length > 0) {
    return registered.map((r) => {
      const liveMatch = (live ?? []).find((s) => s.id && r.snaptrade_account_id && s.id === r.snaptrade_account_id);
      if (liveMatch) {
        return {
          snapAccountId: r.snaptrade_account_id ?? liveMatch.id ?? null,
          brokerAccountId: r.id,
          name: liveMatch.name || r.name || brokerName,
          totalValue: typeof liveMatch.totalValue === 'number' ? liveMatch.totalValue : null,
          cash: typeof liveMatch.cash === 'number' ? liveMatch.cash : null,
          buyingPower: liveMatch.buyingPower ?? null,
          valueSource: 'live' as const,
        };
      }
      const snapMatch = snapshot.find((s) => (s.id ?? null) === (r.snaptrade_account_id ?? null));
      if (snapMatch) {
        const v = snapshotValues(snapMatch);
        return {
          snapAccountId: r.snaptrade_account_id ?? snapMatch.id ?? null,
          brokerAccountId: r.id,
          name: r.name || snapMatch.name || brokerName,
          ...v,
          valueSource: v.totalValue === null ? ('unknown' as const) : ('snapshot' as const),
        };
      }
      return {
        snapAccountId: r.snaptrade_account_id ?? null,
        brokerAccountId: r.id,
        name: r.name || brokerName,
        totalValue: null,
        cash: null,
        buyingPower: null,
        valueSource: 'unknown' as const,
      };
    });
  }

  // ── Legacy path: no registry rows → connection-level behaviour ──
  if (live && live.length > 0) {
    return live.map((s) => ({
      snapAccountId: s.id ?? null,
      brokerAccountId: null,
      name: s.name || brokerName,
      totalValue: typeof s.totalValue === 'number' ? s.totalValue : null,
      cash: typeof s.cash === 'number' ? s.cash : null,
      buyingPower: s.buyingPower ?? null,
      valueSource: 'live' as const,
    }));
  }

  if (snapshot.length > 0) {
    return snapshot.map((s) => {
      const v = snapshotValues(s);
      return {
        snapAccountId: s.id ?? null,
        brokerAccountId: null,
        name: s.name || brokerName,
        ...v,
        valueSource: v.totalValue === null ? ('unknown' as const) : ('snapshot' as const),
      };
    });
  }

  return [{
    snapAccountId: null,
    brokerAccountId: null,
    name: brokerName,
    totalValue: null,
    cash: null,
    buyingPower: null,
    valueSource: 'unknown' as const,
  }];
}
