// ═══════════════════════════════════════════════════════════════
// hooks/usePositionLots.ts — Load position_lots from Supabase
// ═══════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect, useRef } from 'react';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';
import { getActiveLotCount, getTotalRemainingQty, type Lot } from '@/lib/fifo-engine';

export interface PositionLotData {
  lots: Lot[];
  activeLots: number;
  totalRemainingQty: number;
  weightedAvgCost: number;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch position_lots for a given ticker from Supabase.
 * Returns aggregated lot data for the PositionCardV3 component.
 */
export function usePositionLots(
  userId: string | undefined,
  ticker: string,
  connectionId: string | null | undefined,
  enabled: boolean = true // only fetch when card is expanded
): PositionLotData {
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!enabled || !userId || !ticker) {
      setLots([]);
      return;
    }

    let cancelled = false;
    mountedRef.current = true;

    // Capture in local variables for TS narrowing across async boundary
    const uid = userId;
    const symbol = ticker;
    const connId = connectionId;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const client = getSupabaseBrowserClient();
        let query = client
          .from('position_lots')
          .select('*')
          .eq('user_id', uid)
          .eq('ticker', symbol!.toUpperCase())
          .gt('remaining_qty', 0)
          .order('filled_at', { ascending: true });

        // If connectionId is provided, scope to that connection
        if (connId) {
          query = query.eq('account_id', connId);
        }

        const { data, error: fetchErr } = await query;

        if (cancelled) return;

        if (fetchErr) {
          setError(fetchErr.message);
          setLots([]);
        } else {
          const mapped: Lot[] = (data || []).map((row: any) => ({
            id: row.id,
            ticker: row.ticker,
            qty: Number(row.qty),
            remaining_qty: Number(row.remaining_qty),
            price_at_fill: Number(row.price_at_fill),
            filled_at: row.filled_at,
            basket_id: row.basket_id || null,
            origin_tag: row.origin_tag || null,
            source: row.source || null,
          }));
          setLots(mapped);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load lots');
          setLots([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; mountedRef.current = false; };
  }, [userId, ticker, connectionId, enabled]);

  const activeLots = getActiveLotCount(lots);
  const totalRemainingQty = getTotalRemainingQty(lots);
  const weightedAvgCost = totalRemainingQty > 0
    ? lots.filter(l => l.remaining_qty > 0)
        .reduce((sum, l) => sum + l.remaining_qty * l.price_at_fill, 0) / totalRemainingQty
    : 0;

  return {
    lots,
    activeLots,
    totalRemainingQty,
    weightedAvgCost: Math.round(weightedAvgCost * 100) / 100,
    loading,
    error,
  };
}