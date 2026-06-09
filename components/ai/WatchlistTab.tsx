'use client';

import { useState, useEffect, useRef } from 'react';

interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  owned: boolean;
  sharesOwned?: number;
}

interface WatchlistData {
  id: string;
  name: string;
  items: WatchlistItem[];
}

export default function WatchlistTab() {
  const [lists, setLists] = useState<WatchlistData[]>([
    {
      id: '1',
      name: 'Tech Stocks',
      items: [
        { symbol: 'NVDA', name: 'NVIDIA Corp', price: 0, change: 0, changePct: 0, owned: true, sharesOwned: 30 },
        { symbol: 'AMD', name: 'Advanced Micro Devices', price: 0, change: 0, changePct: 0, owned: false },
        { symbol: 'TSLA', name: 'Tesla Inc', price: 0, change: 0, changePct: 0, owned: false },
        { symbol: 'AAPL', name: 'Apple Inc', price: 0, change: 0, changePct: 0, owned: false },
      ],
    },
    {
      id: '2',
      name: 'Dividend Watch',
      items: [
        { symbol: 'KO', name: 'Coca-Cola Co', price: 0, change: 0, changePct: 0, owned: false },
        { symbol: 'JNJ', name: 'Johnson & Johnson', price: 0, change: 0, changePct: 0, owned: false },
        { symbol: 'VZ', name: 'Verizon Communications', price: 0, change: 0, changePct: 0, owned: false },
      ],
    },
  ]);
  const [activeListId, setActiveListId] = useState('1');
  const [loading, setLoading] = useState(true);
  const [showListSelector, setShowListSelector] = useState(false);
  const [showAddSymbol, setShowAddSymbol] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<{ symbol: string; description: string; type: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeList = lists.find((l) => l.id === activeListId) || lists[0];

  // ── fetch real quotes for all symbols ──
  useEffect(() => {
    const fetchAllQuotes = async () => {
      setLoading(true);
      const allSymbols = lists.flatMap((l) => l.items.map((i) => i.symbol));
      const unique = [...new Set(allSymbols)];

      try {
        const quotes = await Promise.all(
          unique.map(async (symbol) => {
            const res = await fetch(
              `/api/finnhub/quote?symbol=${encodeURIComponent(symbol)}`
            );
            const data = await res.json();
            return {
              symbol,
              price: data.c ?? 0,
              change: data.d ?? 0,
              changePct: data.dp ?? 0,
            };
          })
        );

        const quoteMap: Record<string, { price: number; change: number; changePct: number }> = {};
        quotes.forEach((q) => {
          quoteMap[q.symbol] = { price: q.price, change: q.change, changePct: q.changePct };
        });

        setLists((prev) =>
          prev.map((list) => ({
            ...list,
            items: list.items.map((item) => ({
              ...item,
              price: quoteMap[item.symbol]?.price ?? 0,
              change: quoteMap[item.symbol]?.change ?? 0,
              changePct: quoteMap[item.symbol]?.changePct ?? 0,
            })),
          }))
        );
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchAllQuotes();
  }, []);

  // ── debounced symbol search ──
  useEffect(() => {
    if (addQuery.length < 1) {
      setAddResults([]);
      return;
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/finnhub/search?q=${encodeURIComponent(addQuery)}`
        );
        const data = await res.json();
        if (data && data.result) {
          setAddResults(data.result.slice(0, 6));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [addQuery]);

  // ── add symbol to active list ──
  const addSymbol = (symbol: string, name: string) => {
    setLists((prev) =>
      prev.map((list) => {
        if (list.id !== activeListId) return list;
        if (list.items.some((i) => i.symbol === symbol)) return list;
        return {
          ...list,
          items: [
            ...list.items,
            { symbol, name, price: 0, change: 0, changePct: 0, owned: false },
          ],
        };
      })
    );
    setAddQuery('');
    setAddResults([]);
    setShowAddSymbol(false);
  };

  // ── remove symbol ──
  const removeSymbol = (symbol: string) => {
    setLists((prev) =>
      prev.map((list) => {
        if (list.id !== activeListId) return list;
        return { ...list, items: list.items.filter((i) => i.symbol !== symbol) };
      })
    );
  };

  const activeItems = activeList?.items || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ─── 1. Header Row ─── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 16px 8px 16px',
        }}
      >
        {/* List selector */}
        <button
          onClick={() => setShowListSelector(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <span style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>
            {activeList?.name}
          </span>
          <span style={{ fontSize: '12px', color: '#64748b' }}>▾</span>
        </button>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => setShowAddSymbol(true)}
            style={{
              fontSize: '13px',
              color: '#22d3ee',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            + Add
          </button>
          <button
            style={{
              fontSize: '18px',
              color: '#64748b',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ⋯
          </button>
        </div>
      </div>

      {/* ─── 2. Watchlist Rows ─── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeItems.length === 0 ? (
          /* Empty state */
          <div style={{ textAlign: 'center', padding: '60px 16px' }}>
            <p style={{ fontSize: '48px', marginBottom: '16px' }}>⭐</p>
            <p style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>
              No stocks yet
            </p>
            <p style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>
              Add symbols to track them here
            </p>
            <button
              onClick={() => setShowAddSymbol(true)}
              style={{
                marginTop: '20px',
                background: '#22d3ee',
                color: '#000000',
                border: 'none',
                borderRadius: '10px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              + Add Symbol
            </button>
          </div>
        ) : (
          activeItems.map((item) => {
            const changeColor = item.change > 0 ? '#10b981' : item.change < 0 ? '#ef4444' : '#475569';
            const todayVal = (item.change * (item.sharesOwned || 0)).toFixed(0);
            return (
              <div
                key={item.symbol}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  margin: '0 16px 8px 16px',
                  padding: '14px 16px',
                  background: '#1a2235',
                  borderRadius: '10px',
                  borderLeft: `3px solid ${changeColor}`,
                  minHeight: '64px',
                  position: 'relative',
                }}
              >
                {/* Left — symbol + name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '16px',
                        fontWeight: '700',
                        color: '#ffffff',
                      }}
                    >
                      {item.symbol}
                    </span>
                    {item.owned && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: '#22d3ee',
                          background: 'rgba(34,211,238,0.1)',
                          border: '1px solid rgba(34,211,238,0.2)',
                          borderRadius: '4px',
                          padding: '1px 6px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.sharesOwned}sh
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: '12px',
                      color: '#64748b',
                      marginTop: '2px',
                      maxWidth: '160px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </p>
                </div>

                {/* Right — price + change */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p
                    style={{
                      fontSize: '16px',
                      fontWeight: '600',
                      color: '#ffffff',
                    }}
                  >
                    {loading ? '—' : `$${item.price.toFixed(2)}`}
                  </p>
                  <p
                    style={{
                      fontSize: '12px',
                      marginTop: '2px',
                      color: changeColor,
                    }}
                  >
                    {loading
                      ? '—'
                      : `${item.change >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`}
                  </p>
                  {item.owned && (
                    <p
                      style={{
                        fontSize: '11px',
                        color: '#475569',
                        marginTop: '1px',
                      }}
                    >
                      {item.change >= 0 ? '+' : ''}${todayVal} today
                    </p>
                  )}
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSymbol(item.symbol);
                  }}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    width: '20px',
                    height: '20px',
                    background: 'none',
                    border: 'none',
                    color: '#334155',
                    fontSize: '14px',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.5,
                  }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* ─── 3. Add Symbol Button ─── */}
      {activeItems.length > 0 && (
        <div style={{ margin: '8px 16px 16px 16px' }}>
          <button
            onClick={() => setShowAddSymbol(true)}
            style={{
              width: '100%',
              padding: '14px',
              background: 'transparent',
              border: '1px solid #2a3448',
              borderRadius: '10px',
              color: '#64748b',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            + Add Symbol to Watchlist
          </button>
        </div>
      )}

      {/* Spacer for bottom nav */}
      <div style={{ height: '120px', flexShrink: 0 }} />

      {/* ─── 4. List Selector Bottom Sheet ─── */}
      {showListSelector && (
        <>
          <div
            onClick={() => setShowListSelector(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 9998,
            }}
          />
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              background: '#1a2235',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px',
              padding: '24px',
              paddingBottom: '80px',
              zIndex: 9999,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            <p
              style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#ffffff',
                marginBottom: '16px',
              }}
            >
              Your Lists
            </p>

            {lists.map((list) => (
              <div
                key={list.id}
                onClick={() => {
                  setActiveListId(list.id);
                  setShowListSelector(false);
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 0',
                  borderBottom: '1px solid #2a3448',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span
                    style={{
                      color: activeListId === list.id ? '#22d3ee' : '#475569',
                      marginRight: '12px',
                      fontSize: '12px',
                    }}
                  >
                    {activeListId === list.id ? '●' : '○'}
                  </span>
                  <span style={{ fontSize: '15px', color: '#ffffff' }}>
                    {list.name}
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {list.items.length} stocks
                </span>
              </div>
            ))}

            <button
              style={{
                width: '100%',
                marginTop: '16px',
                padding: '14px',
                background: 'transparent',
                border: '1px solid #2a3448',
                borderRadius: '10px',
                color: '#22d3ee',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              + Create New List
            </button>
          </div>
        </>
      )}

      {/* ─── 5. Add Symbol Modal ─── */}
      {showAddSymbol && (
        <>
          <div
            onClick={() => {
              setShowAddSymbol(false);
              setAddQuery('');
              setAddResults([]);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 9998,
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#1a2235',
              border: '1px solid #2a3448',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '380px',
              zIndex: 9999,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <p style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff' }}>
                Add to {activeList?.name}
              </p>
              <button
                onClick={() => {
                  setShowAddSymbol(false);
                  setAddQuery('');
                  setAddResults([]);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Search input */}
            <input
              type="text"
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="Search symbol or company..."
              autoFocus
              style={{
                width: '100%',
                background: '#0f1829',
                border: '1px solid #2a3448',
                borderRadius: '8px',
                padding: '12px 16px',
                color: '#ffffff',
                fontSize: '15px',
                outline: 'none',
                marginBottom: '12px',
                boxSizing: 'border-box',
              }}
            />

            {/* Search results */}
            {searching && (
              <p style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', padding: '16px 0' }}>
                Searching...
              </p>
            )}
            {!searching && addResults.length > 0 && (
              <div>
                {addResults.map((r) => (
                  <div
                    key={r.symbol}
                    onClick={() => addSymbol(r.symbol, r.description || r.symbol)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 0',
                      borderBottom: '1px solid #2a3448',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff' }}>
                        {r.symbol}
                      </p>
                      <p
                        style={{
                          fontSize: '12px',
                          color: '#64748b',
                          marginTop: '2px',
                          maxWidth: '240px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.description}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#22d3ee',
                        background: 'rgba(34,211,238,0.1)',
                        border: '1px solid rgba(34,211,238,0.2)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                      }}
                    >
                      {r.type}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!searching && addQuery && addResults.length === 0 && (
              <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', padding: '16px 0' }}>
                No results found
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
