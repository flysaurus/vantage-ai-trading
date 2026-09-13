'use client';

// ─── useAccountLotsScope ────────────────────────────────────
// THE single place that resolves "which account's lots may I read".
//
// Extracted verbatim from the inline block that used to live in
// components/portfolio/PositionDetail.tsx so that Position Detail AND the
// Holdings-list card (PositionCardV3) resolve the exact same scope from the
// same source — no drift, no parallel path.
//
// The account-scoped lot feed (hooks/useReconstructedLots →
// GET /api/strategies/tax-harvest/lots) wants either:
//   - the raw SnapTrade connection id (no `snaptrade:` prefix) for a
//     live/paper account, or
//   - `isDemo` for the demo portfolio (the route reads the local ledger).
//
// We resolve from the ACTIVE account so a card never reads lots across
// accounts. `activeAccount.isDemo` / `environment === 'demo'` are honoured as
// a belt-and-braces demo signal even when the id didn't parse as `demo`.

import { useMemo } from 'react';
import { useDisplayAccount } from '@/hooks/useDisplayAccount';
import { parseAccountScope } from '@/lib/account-scope';

export interface AccountLotsScope {
  /** Raw SnapTrade connection UUID (no prefix) for live/paper; null otherwise. */
  connectionId: string | null;
  /** Demo / paper account → the route reads the local ledger. */
  isDemo: boolean;
  /** True once a usable scope exists (demo flag or a real connection id). */
  ready: boolean;
}

export function useAccountLotsScope(): AccountLotsScope {
  const { activeAccountId, activeAccount } = useDisplayAccount();

  const accountScope = useMemo(() => parseAccountScope(activeAccountId), [activeAccountId]);
  const connectionId = accountScope && !accountScope.isDemo ? accountScope.connectionId : null;
  const isDemo =
    (accountScope?.isDemo ?? false) ||
    activeAccount?.isDemo === true ||
    activeAccount?.environment === 'demo';

  return { connectionId, isDemo, ready: isDemo || !!connectionId };
}

export default useAccountLotsScope;
