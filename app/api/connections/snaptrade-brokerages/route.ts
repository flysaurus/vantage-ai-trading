// ─── GET /api/connections/snaptrade-brokerages ──────────────────
// Returns brokerages grouped by trading capability.
// Cached from SnapTrade /partners (1-hour TTL).
//
// Response:
// {
//   trading: BrokerInfo[]   — can place trades
//   readOnly: BrokerInfo[]  — data access only, not shown by default
// }

import { requireAuth } from '@/lib/auth/get-server-user';
import { getAllowedBrokerages, BrokerInfo } from '@/lib/snaptrade/auth';
import { NextResponse } from 'next/server';

export async function GET() {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  try {
    const all = await getAllowedBrokerages();

    // Exclude sandbox and practice/duplicate accounts
    const excluded = new Set(['SANDBOX', 'TRADING212-PRACTICE']);

    const filtered = all.filter((b) => {
      if (excluded.has(b.slug.toUpperCase())) return false;
      if (b.releaseStage === 'DEVELOPMENT' && b.slug !== 'MOOMOO') return false;
      return true;
    });

    const trading: BrokerInfo[] = [];
    const readOnly: BrokerInfo[] = [];

    for (const b of filtered) {
      if (b.allowsTrading) {
        trading.push(b);
      } else {
        readOnly.push(b);
      }
    }

    // Sort alphabetically within each group
    const sortByName = (a: BrokerInfo, b: BrokerInfo) =>
      a.displayName.localeCompare(b.displayName);
    trading.sort(sortByName);
    readOnly.sort(sortByName);

    return NextResponse.json({
      trading,
      readOnly,
      total: all.length,
    });
  } catch (err) {
    console.error(
      '[snaptrade-brokerages] Failed to fetch:',
      err instanceof Error ? err.message : 'Unknown',
    );
    return NextResponse.json(
      { error: 'Failed to fetch brokerages from SnapTrade' },
      { status: 502 },
    );
  }
}
