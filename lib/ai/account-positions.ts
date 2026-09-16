import { listConnectedSnapTradeConnections } from '@/lib/snaptrade/client';
import { connectionIdFromAccountId, parseAccountScope } from '@/lib/account-scope';
import { resolveBrokerAccountReadFilter } from '@/lib/broker/account-id';

/**
 * Account-scoped portfolio resolution for AI surfaces (daily brief,
 * weekly snapshot, greeting, etc.).
 *
 * Account IDs (from AccountContext) are either:
 *   - 'demo'                   → demo_portfolio_state
 *   - 'snaptrade:<conn_id>'    → public.positions scoped by connection_id
 *                                (conn_id = broker_connections.id)
 *
 * Falls back to the legacy behaviour (any broker → positions, else demo)
 * when no accountId is supplied, so existing callers keep working.
 */

export interface AccountPositions {
  positions: any[];
  cashBalance: number;
  holdingsUnavailable: boolean;
  isBrokerConnected: boolean;
  accountId: string;
}

function extractConnectionId(accountId: string): string | null {
  if (accountId.startsWith('snaptrade:')) return connectionIdFromAccountId(accountId);
  // Defensive: accept a bare UUID as the connection id
  if (/^[0-9a-fA-F-]{36}$/.test(accountId)) return accountId;
  return null;
}

async function resolveBrokerPositions(
  supabase: any,
  userId: string,
  connectionId?: string | null,
  snapAccountId?: string | null,
): Promise<AccountPositions> {
  // Part B step 4 — dual-read. On a connection that exposes 2+ sub-accounts
  // the connection scope is the SUMMED book (the original bug); narrow to the
  // named sub-account instead. A single-account connection, or a failed
  // lookup, keeps exactly today's connection-scoped query — unstamped legacy
  // rows stay readable there, where the scope is not ambiguous either way.
  const filter = await resolveBrokerAccountReadFilter(supabase, {
    userId,
    connectionId,
    snapAccountId,
  });

  // Shared login with no usable sub-account scope: returning the connection's
  // rows would merge two accounts. Report holdings as unavailable (item 2's
  // rule: a multi-account connection hides connection-level rows).
  if (filter.reason === 'shared_login_no_scope') {
    console.warn(
      '[account-positions] shared login without a sub-account scope — not merging holdings',
    );
    return {
      positions: [],
      cashBalance: 0,
      holdingsUnavailable: true,
      isBrokerConnected: true,
      accountId: connectionId ? `snaptrade:${connectionId}` : 'broker',
    };
  }

  let query = (supabase as any)
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .neq('qty', 0);

  if (connectionId) {
    query = query.eq('connection_id', connectionId);
  }

  if (filter.filterAccountId) {
    query = query.eq('account_id', filter.filterAccountId);
  }

  const { data: brokerPositions } = await query;

  console.log(
    `[account-positions] scope=${filter.reason} account=${filter.filterAccountId ? filter.filterAccountId.slice(0, 8) : '-'} rows=${brokerPositions?.length ?? 0}`,
  );

  // NOTE: holdings-unavailability is a live SnapTrade concept surfaced via the
  // account route (sync_status), not persisted on broker_connections. An empty
  // positions table here is surfaced downstream as 'no_positions'.
  return {
    positions: brokerPositions || [],
    cashBalance: 0, // broker cash is intentionally not folded into the brief
    holdingsUnavailable: false,
    isBrokerConnected: true,
    accountId: connectionId
      ? `snaptrade:${connectionId}${snapAccountId ? `:${snapAccountId}` : ''}`
      : 'broker',
  };
}

async function resolveDemoPositions(
  supabase: any,
  userId: string,
): Promise<AccountPositions> {
  const { data: demoState } = await (supabase as any)
    .from('demo_portfolio_state')
    .select('positions, cash_balance')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    positions: demoState?.positions || [],
    cashBalance: demoState?.cash_balance ?? 0,
    holdingsUnavailable: false, // demo holdings are always available
    isBrokerConnected: false,
    accountId: 'demo',
  };
}

export async function resolveAccountPositions(
  supabase: any,
  userId: string,
  accountId: string | null | undefined,
): Promise<AccountPositions> {
  // Explicit broker account selection
  if (accountId && accountId !== 'demo') {
    const parsed = parseAccountScope(accountId);
    const connId = parsed?.connectionId ?? extractConnectionId(accountId);
    if (connId) {
      return resolveBrokerPositions(
        supabase,
        userId,
        connId,
        parsed?.snapAccountId ?? null,
      );
    }
    // Unknown account id — fall through to legacy resolution
  }

  // Explicit demo selection
  if (accountId === 'demo') {
    return resolveDemoPositions(supabase, userId);
  }

  // Legacy (no accountId): broker if any connection exists, else demo
  const connectedConnections = await listConnectedSnapTradeConnections(userId);
  if (connectedConnections.length > 0) {
    return resolveBrokerPositions(supabase, userId, null);
  }
  return resolveDemoPositions(supabase, userId);
}
