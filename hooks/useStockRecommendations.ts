'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StockData, AllStylesResult } from '@/lib/advisor/engine';

// ─── Types ────────────────────────────────────────────────────

interface RecommendationsResponse {
  symbol: string;
  stockData: StockData;
  recommendations: AllStylesResult;
  timestamp: string;
}

export interface UseStockRecommendationsResult {
  symbol?: string;
  stockData?: StockData;
  recommendations?: AllStylesResult;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  refetch: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useStockRecommendations(
  symbol: string | null,
  enabled: boolean = true
): UseStockRecommendationsResult {
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSymbol = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) return;

    setIsLoading(true);
    setIsError(false);
    setError(null);

    try {
      const res = await fetch(
        `/api/advisor/recommendations?symbol=${encodeURIComponent(symbol.toUpperCase())}`
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch recommendations (${res.status})`);
      }

      const json: RecommendationsResponse = await res.json();
      setData(json);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch recommendations';
      setIsError(true);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [symbol]);

  // Fetch when symbol changes (or enabled toggles)
  useEffect(() => {
    if (!enabled || !symbol || symbol === lastSymbol.current) return;
    lastSymbol.current = symbol;
    fetchData();
  }, [symbol, enabled, fetchData]);

  // Manual refetch
  const refetch = useCallback(() => {
    lastSymbol.current = null; // bypass "same symbol" check
    fetchData();
  }, [fetchData]);

  return {
    symbol: data?.symbol,
    stockData: data?.stockData,
    recommendations: data?.recommendations,
    isLoading,
    isError,
    error,
    refetch,
  };
}
