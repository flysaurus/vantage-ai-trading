// ═══════════════════════════════════════════════════════════════
// hooks/useReconstructedLots.ts — the ONE account-scoped lot feed
// ═══════════════════════════════════════════════════════════════
//
// Wraps GET /api/strategies/tax-harvest/lots for a single symbol.
//
// The route FIFO-replays REAL broker activities into genuine lots and
// reports any shares that predate the activity window under
// `unknownStartByTicker`. This hook surfaces both, mapped to the canonical
// `Lot` shape from lib/fifo-engine.ts, so Position Detail (and anyone else)
// reads the same lots the wash-sale checker and holding-period split do —
// scoped to the ACTIVE account, never across all of them.
//
// Always account-scoped: pass the raw SnapTrade connection id (no
// `snaptrade:` prefix), or `isDemo: true` for the demo portfolio.

'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import type { Lot } from '@/lib/fifo-engine';
import type { UnknownStartInfo } from '@/lib/tax-harvest/lot-reconstruction';
import type { TaxHarvestLotsResponse } from '@/app/api/strategies/tax-harvest/lots/route';

export interface UseReconstructedLotsArgs {
  /** Raw SnapTrade connection UUID (no `snaptrade:` prefix). Null for demo. */
  connectionId: string | null;
  /** Demo / paper account — the route reads the local ledger instead. */
  isDemo: boolean;
  /** Ticker to extract. Matched case-insensitively. */
  symbol: string;
  /** Set false to skip the fetch entirely and return empty state. */
  enabled?: boolean;
}

export interface UseReconstructedLotsResult {
  /** The symbol's lots mapped to the canonical shape, oldest fill first. */
  lots: Lot[];
  /** This symbol's unknown-start disclosure, or null. */
  unknownStart: UnknownStartInfo | null;
  /** Where the lots actually came from (degraded sources are reported, not hidden). */
  source: TaxHarvestLotsResponse['source'] | null;
  loading: boolean;
  error: string | null;
  /** Start of the broker activity window, if the feed reported one. */
  windowStartDate: string | null;
}

export function useReconstructedLots({
  connectionId,
  isDemo,
  symbol,
  enabled = true,
}: UseReconstructedLotsArgs): UseReconstructedLotsResult {
  const [lots, setLots] = useState<Lot[]>([]);
  const [unknownStart, setUnknownStart] = useState<UnknownStartInfo | null>(null);
  const [source, setSource] = useState<TaxHarvestLotsResponse['source'] | null>(null);
  const [windowStartDate, setWindowStartDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Account-scoped feed needs either a connection id or the demo flag.
    const active = enabled && !!symbol && (isDemo || !!connectionId);

    if (!active) {
      setLots([]);
      setUnknownStart(null);
      setSource(null);
      setWindowStartDate(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const sym = symbol.toUpperCase();

    const params = new URLSearchParams();
    if (isDemo) params.set('demo', '1');
    else params.set('connectionId', connectionId as string);

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await apiGet(`/api/strategies/tax-harvest/lots?${params.toString()}`);
        if (cancelled) return;

        if (!res.ok) {
          setError(`Failed to load lots (${res.status})`);
          setLots([]);
          setUnknownStart(null);
          setSource(null);
          setWindowStartDate(null);
          return;
        }

        const data = (await res.json()) as TaxHarvestLotsResponse;
        if (cancelled) return;

        const rawLots = data.lotsByTicker?.[sym] ?? [];
        const mapped: Lot[] = rawLots
          .map((l) => ({
            id: l.id,
            ticker: l.ticker,
            qty: l.qty,
            remaining_qty: l.remainingQty,
            price_at_fill: l.priceAtFill,
            filled_at: l.filledAt,
          }))
          // Oldest-first so FIFO ordering reads naturally in the UI.
          .sort((a, b) => new Date(a.filled_at).getTime() - new Date(b.filled_at).getTime());

        setLots(mapped);
        setUnknownStart(data.unknownStartByTicker?.[sym] ?? null);
        setSource(data.source ?? null);
        setWindowStartDate(data.windowStartDate ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load lots');
        setLots([]);
        setUnknownStart(null);
        setSource(null);
        setWindowStartDate(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionId, isDemo, symbol, enabled]);

  return { lots, unknownStart, source, loading, error, windowStartDate };
}

export default useReconstructedLots;
