// ─── Account List Endpoint ────────────────────────────────────
// GET /api/accounts
//
// Returns a unified list of all user accounts:
// 1. Demo Portfolio (always present)
// 2. Each connected SnapTrade broker with account summary
//
// Used by AccountSwitcher to populate the persistent account selector.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';
import { withTimeout } from '@/lib/async-guards';
import { enumerateConnectionAccounts, type RegisteredAccountRow } from '@/lib/broker/account-enumeration';
import { deriveTradingCapability, type TradingCapability } from '@/lib/broker/trading-capability';

// ── Bounded live fetch + short TTL cache ────────────────────
// The live SnapTrade round-trip (accounts list + one balances call per
// sub-account) is the slow part of first load — a multi-sub-account broker like
// Fidelity does 1 + N sequential-ish round trips, and a hanging upstream turned
// "slow" into "failed first load". Two guards:
//   1. withTimeout — a hung broker fetch can no longer stall the route; we
//      fall back to the stored `snaptrade_accounts` snapshot (see catch).
//   2. a short in-process TTL cache — repeat reads (account switcher reopen,
//      tab navigation) don't re-pay the round-trip.
const ACCOUNTS_LIVE_TIMEOUT_MS = 8_000;
const ACCOUNTS_CACHE_TTL_MS = 30_000;
type SubAccountSummary = { id: string | null; name: string; totalValue: number; cash: number; buyingPower: number | null };
const subAccountsCache = new Map<string, { at: number; value: SubAccountSummary[] }>();

export interface AccountEntry {
  id: string;
  name: string;
  broker: string;
  brokerageSlug?: string; // e.g. 'ALPACA-PAPER' — for logo lookups
  isDemo: boolean;
  tradingEnabled: boolean;
  /** Per-account trading capability, derived from this entry's own metadata. */
  tradingCapability: TradingCapability;
  totalValue: number | null; // null = unknown (never a fabricated 0)
  buyingPower: number | null;
  cash: number | null; // null = unknown (never a fabricated 0)
  environment: 'demo' | 'paper' | 'live';
  connectionId?: string; // broker_connections UUID, only for live accounts
  snapAccountId?: string; // SnapTrade sub-account id (3-part id form), when known
  /** `broker_accounts.id` — the registry row this entry was enumerated from. */
  brokerAccountId?: string | null;
  /** Where the money values came from — 'unknown' prints as a dash. */
  valueSource?: 'live' | 'snapshot' | 'unknown';
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const accounts: AccountEntry[] = [];

    // ── 1. Demo account — always present ──
    // Fetch demo portfolio state for total value
    const { data: demoState } = await supabaseAdmin
      .from('demo_portfolio_state')
      .select('positions, cash_balance')
      .eq('user_id', userId)
      .maybeSingle();

    let demoEquity = 100_000;
    let demoCash = 100_000;
    if (demoState) {
      demoCash = demoState.cash_balance ?? 100_000;
      const positions = (demoState.positions as any[]) || [];
      const positionValue = positions
        .filter((p: any) => p?.symbol && p.symbol !== '')
        .reduce((sum: number, p: any) => sum + (p.marketValue ?? p.totalCost ?? 0), 0);
      demoEquity = demoCash + positionValue;
    }

    accounts.push({
      id: 'demo',
      name: 'Demo Portfolio',
      broker: 'Vantage Demo',
      isDemo: true,
      tradingEnabled: true,
      tradingCapability: 'full', // demo is always tradable
      totalValue: demoEquity,
      buyingPower: demoCash, // Demo: buying power = cash (no margin)
      cash: demoCash,
      environment: 'demo',
      valueSource: 'live' as const,
    });

    // ── 2. SnapTrade broker connections ──
    const { data: connections } = await supabaseAdmin
      .from('broker_connections')
      .select('id, brokerage_slug, trading_enabled, snaptrade_accounts, snaptrade_connection_id, snaptrade_user_id, snaptrade_user_secret_encrypted, status')
      .eq('user_id', userId)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected');

    // ── 2b. The per-account registry (`broker_accounts`, step 2) ──
    // Enumeration source of truth. One bulk read for all of the user's
    // connections; ownership is established through `broker_connections`
    // (`broker_accounts` has no user_id column), so we scope by connection id.
    const connectionIds = (connections ?? []).map((c: any) => c.id as string);
    let registryRows: RegisteredAccountRow[] = [];
    if (connectionIds.length > 0) {
      const { data: acctRows, error: acctErr } = await supabaseAdmin
        .from('broker_accounts')
        .select('id, connection_id, snaptrade_account_id, name, status')
        .in('connection_id', connectionIds);
      if (acctErr) {
        console.warn('[accounts] broker_accounts registry read failed — falling back to connection-level enumeration:', acctErr.message);
      } else {
        registryRows = (acctRows ?? []) as RegisteredAccountRow[];
      }
    }

    if (connections) {
      for (const conn of connections) {
        const snapAccounts = (conn.snaptrade_accounts as any[]) || [];
        const brokerName = mapSlugToName(conn.brokerage_slug);
        const environment: 'paper' | 'live' =
          conn.brokerage_slug === 'ALPACA-PAPER' ? 'paper' : 'live';

        // ── Enumerate every SnapTrade SUB-ACCOUNT separately ──
        // A connection can expose several accounts (Fidelity → "Taxable SMA" +
        // "ANIKET - YOUTH"). Each is its own entry with its OWN balances —
        // never summed. Bounded fetch + short TTL cache so a second read doesn't
        // re-pay the round-trip.
        const cached = subAccountsCache.get(conn.id);
        let subs: SubAccountSummary[] | null =
          cached && Date.now() - cached.at < ACCOUNTS_CACHE_TTL_MS ? cached.value : null;

        if (!subs) {
          try {
            const snapUser = await getOrCreateSnapTradeUser(
              userId,
              conn.snaptrade_user_id,
              conn.snaptrade_user_secret_encrypted,
            );
            const broker = new SnapTradeBroker({
              userId: snapUser.userId,
              userSecret: snapUser.userSecret,
              connectionId: conn.snaptrade_connection_id || '',
              brokerSlug: conn.brokerage_slug,
              brokerName,
              tradingEnabled: conn.trading_enabled ?? false,
            });
            const live = await withTimeout(broker.listSubAccounts(), ACCOUNTS_LIVE_TIMEOUT_MS, 'accounts:snaptrade');
            if (live.length > 0) {
              subs = live.map((s) => ({ ...s, id: s.id || null }));
              subAccountsCache.set(conn.id, { at: Date.now(), value: subs });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const errStack = err instanceof Error ? (err.stack || '').substring(0, 200) : '';
            console.error('[accounts] SnapTrade live fetch FAILED (using stored snapshot):', errMsg, errStack);
          }
        }

        if (!subs || subs.length === 0) {
          // Live fetch failed or returned nothing. The stored snapshot is NOT an
          // enumeration source when the registry has rows — it is only a value
          // fallback inside `enumerateConnectionAccounts`.
          subs = [];
        }

        // Registry = enumeration. A connection with registered sub-accounts
        // emits exactly those (never a widened, connection-level entry); a
        // connection without registry rows keeps the legacy connection-level
        // behaviour.
        const registered = registryRows.filter((r) => r.connection_id === conn.id);
        const enumerated = enumerateConnectionAccounts({
          registered,
          live: subs,
          snapshot: snapAccounts,
          brokerName,
        });

        const multi = enumerated.length > 1;
        for (const sub of enumerated) {
          const tradingEnabled = conn.trading_enabled ?? false;
          accounts.push({
            id: sub.snapAccountId ? `snaptrade:${conn.id}:${sub.snapAccountId}` : `snaptrade:${conn.id}`,
            name: sub.name || brokerName,
            broker: brokerName,
            brokerageSlug: conn.brokerage_slug,
            isDemo: false,
            tradingEnabled,
            // Per-account: the capability is a function of THIS entry's own
            // metadata (never a connection-wide assumption read from a sibling).
            tradingCapability: deriveTradingCapability({ isDemo: false, tradingEnabled }),
            totalValue: sub.totalValue,
            buyingPower: sub.buyingPower,
            cash: sub.cash,
            environment,
            connectionId: conn.id,
            snapAccountId: sub.snapAccountId || undefined,
            brokerAccountId: sub.brokerAccountId,
            valueSource: sub.valueSource,
          });
          if (multi && !sub.snapAccountId) {
            // Entries are not individually addressable — label them so the UI
            // can tell them apart.
            accounts[accounts.length - 1].name = `${brokerName} · ${sub.name}`;
          }
        }
      }
    }

    return NextResponse.json({ accounts });
  } catch (err: unknown) {
    console.error('[accounts] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function mapSlugToName(slug: string): string {
  const map: Record<string, string> = {
    'ALPACA-PAPER': 'Alpaca Paper',
    'ALPACA': 'Alpaca',
    'FIDELITY': 'Fidelity',
    'TASTYTRADE': 'Tastytrade',
    'ETRADE': 'E*TRADE',
    'WEBULL': 'Webull',
    'PUBLIC': 'Public',
    'MOOMOO': 'Moomoo',
    'IBKR': 'Interactive Brokers',
    'SCHWAB': 'Charles Schwab',
    'ROBINHOOD': 'Robinhood',
  };
  return map[slug] || slug;
}
