// ─── useMarketData ────────────────────────────────────────────
// Fetches real market data from the broker: index prices,
// watchlist quotes, and live streaming updates.
// Fetches live market data from the broker.

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMarketStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';
import { getDemoIndexes, getDemoQuotes, getAllDemoSymbols } from '@/lib/demo-data';
import type { MarketIndex, Quote, WatchlistItem } from '@/types';

// Indices and watchlist are now persisted in the market store (localStorage).
// Defaults are defined in store/index.ts for first-time users only.
const POLL_INTERVAL = 30000; // 30 seconds

export function useMarketData() {
  const {
    setIndexes,
    setWatchlist,
    updateQuote,
    setMarketOpen,
    indexSymbols,
    watchlist,
  } = useMarketStore();

  const { broker, isConnected } = useBroker();
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsCleanup = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  // Fetch index data and market status
  const fetchMarketData = useCallback(async () => {
    if (!broker || !isConnected) return;

    try {
      const [quotesResp, marketStatus] = await Promise.all([
        broker.getQuotes(indexSymbols),
        broker.getMarketStatus(),
      ]);

      setMarketOpen(marketStatus.isOpen);

      // Map broker quotes to MarketIndex type
      const indexes: MarketIndex[] = quotesResp.map((q) => ({
        symbol: q.symbol,
        price: q.last || q.ask || 0,
        change: q.change || 0,
        changePercent: q.changePercent || 0,
      }));

      setIndexes(indexes);

      // Also populate quote store for detailed views
      quotesResp.forEach((q) => {
        updateQuote(q.symbol, {
          symbol: q.symbol,
          bid: q.bid,
          ask: q.ask,
          last: q.last || q.ask,
          change: q.change,
          changePercent: q.changePercent,
          volume: q.volume,
          high52w: q.high52w,
          low52w: q.low52w,
        });
      });
    } catch (err) {
      console.warn('[useMarketData] Failed to fetch index data:', err);
    }
  }, [broker, isConnected, setIndexes, setMarketOpen, updateQuote]);

  // Fetch watchlist quotes
  const fetchWatchlist = useCallback(async () => {
    if (!broker || !isConnected || watchlist.length === 0) return;

    try {
      const symbols = watchlist.map((w) => w.symbol);
      const quotes = await broker.getQuotes(symbols);

      // Update watchlist with live data
      const watchlistWithData: WatchlistItem[] = symbols.map((sym) => {
        const q = quotes.find((q) => q.symbol === sym);
        return {
          symbol: sym,
          changePercent: q?.changePercent ?? 0,
          change: q?.change,
        };
      });

      setWatchlist(watchlistWithData);

      // Update quote store
      quotes.forEach((q) => {
        updateQuote(q.symbol, {
          symbol: q.symbol,
          bid: q.bid,
          ask: q.ask,
          last: q.last || q.ask,
          change: q.change,
          changePercent: q.changePercent,
          volume: q.volume,
          high52w: q.high52w,
          low52w: q.low52w,
        });
      });
    } catch (err) {
      console.warn('[useMarketData] Failed to fetch watchlist:', err);
    }
  }, [broker, isConnected, watchlist, setWatchlist, updateQuote]);

  // WebSocket streaming for live quotes on all tracked symbols
  const setupStreaming = useCallback(() => {
    if (!broker || !isConnected) return;

    const store = useMarketStore.getState();
    const allSymbols = [
      ...store.indexSymbols,
      ...store.watchlist.map((w) => w.symbol),
    ];

    try {
      const cleanup = broker.subscribe(allSymbols, (q) => {
        updateQuote(q.symbol, {
          symbol: q.symbol,
          bid: q.bid,
          ask: q.ask,
          last: q.last || q.ask,
          change: q.change,
          changePercent: q.changePercent,
          volume: q.volume,
          high52w: q.high52w,
          low52w: q.low52w,
        });

        // Also update index store if it's an index symbol
        if (useMarketStore.getState().indexSymbols.includes(q.symbol)) {
          const store = useMarketStore.getState();
          const updated = store.indexes.map((idx) =>
            idx.symbol === q.symbol
              ? {
                  ...idx,
                  price: q.last || q.ask || idx.price,
                  change: q.change || idx.change,
                  changePercent: q.changePercent || idx.changePercent,
                }
              : idx
          );
          setIndexes(updated);
        }
      });

      wsCleanup.current = cleanup;
    } catch (err) {
      console.warn('[useMarketData] WebSocket setup failed:', err);
    }
  }, [broker, isConnected, updateQuote, setIndexes]);

  // Initial data load
  useEffect(() => {
    if (!isConnected) {
      // Time-based fallback when no broker connected
      const checkMarketStatus = () => {
        const now = new Date();
        const day = now.getUTCDay();
        const h = now.getUTCHours();
        const m = now.getUTCMinutes();
        // US market: 9:30 AM - 4:00 PM ET Mon-Fri (13:30-20:00 UTC during DST)
        const isOpen = day >= 1 && day <= 5
          && (h > 13 || (h === 13 && m >= 30))
          && !(h > 20 || (h === 20 && m > 0));
        setMarketOpen(isOpen);
      };
      checkMarketStatus();
      // Re-check market status every 60s so it updates when market opens without a refresh
      pollInterval.current = setInterval(checkMarketStatus, 60000);

      // Populate demo market data from Finnhub (no hardcoded fallback)
      const symbols = getAllDemoSymbols();
      fetch('/api/market/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
        .then(res => res.ok ? res.json() : Promise.reject(res))
        .then(data => {
          if (!data?.quotes || !mountedRef.current) return;
          const indexes = getDemoIndexes(data.quotes);
          const quotes = getDemoQuotes(data.quotes);
          setIndexes(indexes);
          for (const [symbol, quote] of Object.entries(quotes)) {
            updateQuote(symbol, quote);
          }
        })
        .catch(() => {
          // Silently fail — market bar shows "—" for unavailable prices
        });
      // Don't return early — still need the cleanup below to clear the interval
    } else {

    // Fetch initial data
    Promise.all([fetchMarketData(), fetchWatchlist()]).then(() => {
      // After initial fetch, start streaming
      setupStreaming();

      // Set up polling fallback every 60s in case WebSocket drops
      pollInterval.current = setInterval(() => {
        fetchMarketData();
      }, 60000);
    });

    return () => {
      mountedRef.current = false;
      wsCleanup.current?.();
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
      pollInterval.current = null;
    };
  }, [isConnected]);

  const getQuote = useCallback(
    (symbol: string): Quote | undefined => {
      const s = useMarketStore.getState();
      return s.quotes[symbol];
    },
    []
  );

  return { getQuote };
}
