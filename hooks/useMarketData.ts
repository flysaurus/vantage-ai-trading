// ─── useMarketData ────────────────────────────────────────────
// Fetches real market data from the broker: index prices,
// watchlist quotes, and live streaming updates.
// Replaces the previous mock data implementation.

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMarketStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';
import type { MarketIndex, Quote, WatchlistItem } from '@/types';

// Default index tracking ETF symbols
const DEFAULT_INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLF'];

// Default watchlist symbols
const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { symbol: 'NVDA' },
  { symbol: 'AAPL' },
  { symbol: 'TSLA' },
  { symbol: 'META' },
  { symbol: 'AMZN' },
  { symbol: 'GOOGL' },
];

export function useMarketData() {
  const {
    setIndexes,
    setWatchlist,
    updateQuote,
    setMarketOpen,
  } = useMarketStore();

  const { broker, connected } = useBroker();
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsCleanup = useRef<(() => void) | null>(null);

  // Fetch index data and market status
  const fetchMarketData = useCallback(async () => {
    if (!broker || !connected) return;

    try {
      const [quotesResp, marketStatus] = await Promise.all([
        broker.getQuotes(DEFAULT_INDEX_SYMBOLS),
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
  }, [broker, connected, setIndexes, setMarketOpen, updateQuote]);

  // Fetch watchlist quotes
  const fetchWatchlist = useCallback(async () => {
    if (!broker || !connected) return;

    const symbols = DEFAULT_WATCHLIST.map((w) => w.symbol);

    try {
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
  }, [broker, connected, setWatchlist, updateQuote]);

  // WebSocket streaming for live quotes on all tracked symbols
  const setupStreaming = useCallback(() => {
    if (!broker || !connected) return;

    const allSymbols = [
      ...DEFAULT_INDEX_SYMBOLS,
      ...DEFAULT_WATCHLIST.map((w) => w.symbol),
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
        if (DEFAULT_INDEX_SYMBOLS.includes(q.symbol)) {
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
  }, [broker, connected, updateQuote, setIndexes]);

  // Initial data load
  useEffect(() => {
    if (!connected) {
      setMarketOpen(false);
      return;
    }

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
      wsCleanup.current?.();
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
      pollInterval.current = null;
    };
  }, [connected]);

  const getQuote = useCallback(
    (symbol: string): Quote | undefined => {
      const s = useMarketStore.getState();
      return s.quotes[symbol];
    },
    []
  );

  return { getQuote };
}
