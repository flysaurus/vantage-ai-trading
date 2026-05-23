// ─── useLiveQuotes ──────────────────────────────────────────
// Real-time quote streaming via the broker's WebSocket subscribe().
// Returns a Map<string, Quote> updated in real-time.
// Handles connection lifecycle, reconnection, and cleanup.

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useBroker } from '@/components/providers/BrokerProvider';
import type { BrokerQuote } from '@/types/broker';

// Minimal Quote used in the app UI
export interface LiveQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  change: number;
  changePercent: number;
  volume: number;
  high52w: number;
  low52w: number;
  timestamp: number;
}

interface UseLiveQuotesResult {
  quotes: Map<string, LiveQuote>;
  connected: boolean;
  error: string | null;
  subscribe: (symbols: string[]) => void;
}

const RECONNECT_DELAY = 3000;
const MAX_RECONNECTS = 5;

export function useLiveQuotes(initialSymbols: string[] = []): UseLiveQuotesResult {
  const { broker, connected: brokerConnected } = useBroker();
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(new Map());
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quotesRef = useRef<Map<string, LiveQuote>>(new Map());
  const symbolsRef = useRef<string[]>(initialSymbols);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const subscribe = useCallback(
    (symbols: string[]) => {
      symbolsRef.current = symbols;
      reconnectAttempts.current = 0;

      // Clean up existing connection
      cleanupRef.current?.();

      if (!broker || !brokerConnected || symbols.length === 0) return;

      const handleQuote = (q: BrokerQuote) => {
        const liveQuote: LiveQuote = {
          symbol: q.symbol,
          bid: q.bid,
          ask: q.ask,
          last: q.last || q.ask,
          change: q.change,
          changePercent: q.changePercent,
          volume: q.volume,
          high52w: q.high52w,
          low52w: q.low52w,
          timestamp: q.timestamp || Date.now(),
        };

        const next = new Map(quotesRef.current);
        next.set(q.symbol, liveQuote);
        quotesRef.current = next;

        if (mountedRef.current) {
          setQuotes(next);
        }
      };

      try {
        const cleanup = broker.subscribe(symbols, handleQuote);
        cleanupRef.current = cleanup;
        setWsConnected(true);
        setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'WebSocket connection failed';
        setError(message);
        setWsConnected(false);

        // Auto-reconnect
        if (reconnectAttempts.current < MAX_RECONNECTS) {
          reconnectAttempts.current++;
          reconnectTimer.current = setTimeout(() => {
            if (mountedRef.current) {
              subscribe(symbolsRef.current);
            }
          }, RECONNECT_DELAY * reconnectAttempts.current);
        }
      }
    },
    [broker, brokerConnected]
  );

  // Initial subscription
  useEffect(() => {
    mountedRef.current = true;

    if (initialSymbols.length > 0) {
      subscribe(initialSymbols);
    }

    return () => {
      mountedRef.current = false;
      cleanupRef.current?.();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [brokerConnected]); // Re-subscribe when broker connects

  return {
    quotes,
    connected: wsConnected,
    error,
    subscribe,
  };
}
