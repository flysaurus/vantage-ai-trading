'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  getWatchlists, createWatchlist, updateWatchlist, deleteWatchlist,
  addStockToWatchlist, removeStockFromWatchlist,
  type Watchlist,
} from '@/lib/supabase/watchlists';
import {
  ArrowLeft, Plus, Edit3, Trash2, X, Search,
  ChevronRight, ChevronDown, Star, TrendingUp, TrendingDown,
  Minus, Clock, RefreshCcw,
} from 'lucide-react';

// ─── Quote type ───────────────────────────────────────────────
interface StockQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

// ─── Page ─────────────────────────────────────────────────────
export default function WatchlistsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Watchlist | null>(null);
  const [deleting, setDeleting] = useState<Watchlist | null>(null);

  // Expanded watchlist
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);

  // Add stock to expanded watchlist
  const [addingSymbol, setAddingSymbol] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuggestions, setAddSuggestions] = useState<Array<{ symbol: string; name: string }>>([]);
  const addingSymbolTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchAddSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 1) { setAddSuggestions([]); return; }
    try {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(query.toUpperCase())}`);
      if (res.ok) {
        const data = await res.json();
        setAddSuggestions((data.results || []).slice(0, 6));
      }
    } catch {
      setAddSuggestions([]);
    }
  }, []);

  // ─── Load watchlists ────────────────────────────────────────
  const loadWatchlists = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getWatchlists(user.id as string);
      setWatchlists(data);
    } catch {
      setError('Failed to load watchlists');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadWatchlists(); }, [loadWatchlists]);

  // ─── Load quotes for expanded watchlist ─────────────────────
  const loadQuotes = useCallback(async (stocks: { symbol: string }[]) => {
    if (!stocks.length) { setQuotes({}); return; }
    setQuotesLoading(true);
    try {
      const symbols = stocks.map(s => s.symbol).join(',');
      const res = await fetch(`/api/alpaca/market?symbols=${encodeURIComponent(symbols)}`);
      if (!res.ok) throw new Error('Failed to fetch quotes');
      const data = await res.json();
      const qs: Record<string, StockQuote> = {};
      // data.quotes format: { AAPL: { symbol, bid, ask, last, change, changePercent, ... } }
      const raw = data.quotes || data || {};
      for (const sym of Object.keys(raw)) {
        const q = raw[sym];
        // Market API returns: last, ask, bid, change, changePercent
        const price = q.last ?? q.ask ?? q.bid ?? null;
        const change = q.change ?? null;
        const changePercent = q.changePercent ?? null;
        qs[sym] = { symbol: sym, price, change, changePercent };
      }
      setQuotes(qs);
    } catch {
      // silently fail — quotes are nice-to-have
    } finally {
      setQuotesLoading(false);
    }
  }, []);

  const handleExpand = async (wl: Watchlist) => {
    if (expandedId === wl.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(wl.id);
    setAddError(null);
    setAddingSymbol('');
    if (wl.stocks && wl.stocks.length > 0) {
      await loadQuotes(wl.stocks);
    } else {
      setQuotes({});
    }
  };

  // ─── Create / Edit with error feedback ─────────────────────
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async (name: string, description: string, initialStocks: string[]) => {
    if (!user || !name.trim()) return;
    setCreating(true);
    setCreateError(null);
    const result = await createWatchlist({ userId: user.id as string, name: name.trim(), description: description.trim() || undefined });
    if (result) {
      // Add initial stocks if provided
      if (initialStocks.length > 0) {
        for (const sym of initialStocks) {
          await addStockToWatchlist(result.id, sym);
        }
        // Reload the watchlist to get full stocks array
        const updated = await getWatchlists(user.id as string);
        setWatchlists(updated);
      } else {
        setWatchlists(prev => [result, ...prev]);
      }
      setShowCreate(false);
      setCreating(false);
    } else {
      setCreateError('Failed to create watchlist. Please try again.');
      setCreating(false);
    }
  };

  const [editingError, setEditingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleUpdate = async (name: string, description: string) => {
    if (!editing || !name.trim()) return;
    setSaving(true);
    setEditingError(null);
    const result = await updateWatchlist(editing.id, { name: name.trim(), description: description.trim() || undefined });
    if (result) {
      setWatchlists(prev => prev.map(w => w.id === editing.id ? { ...w, name: result.name, description: result.description, updatedAt: result.updatedAt } : w));
      setEditing(null);
    } else {
      setEditingError('Failed to update watchlist.');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const ok = await deleteWatchlist(deleting.id);
    if (ok) {
      setWatchlists(prev => prev.filter(w => w.id !== deleting.id));
      if (expandedId === deleting.id) setExpandedId(null);
    }
    setDeleting(null);
  };

  const handleAddStock = async () => {
    if (!expandedId || !addingSymbol.trim()) return;
    setAddError(null);
    const sym = addingSymbol.trim().toUpperCase();
    const result = await addStockToWatchlist(expandedId, sym);
    if (result) {
      setWatchlists(prev => prev.map(w => w.id === expandedId ? { ...w, stocks: result.stocks, updatedAt: result.updatedAt } : w));
      setAddingSymbol('');
      // reload quotes to include new stock
      await loadQuotes(result.stocks);
    } else {
      setAddError('Symbol not found or already in list');
    }
  };

  const handleRemoveStock = async (symbol: string) => {
    if (!expandedId) return;
    const result = await removeStockFromWatchlist(expandedId, symbol);
    if (result) {
      setWatchlists(prev => prev.map(w => w.id === expandedId ? { ...w, stocks: result.stocks, updatedAt: result.updatedAt } : w));
      setQuotes(prev => { const n = { ...prev }; delete n[symbol]; return n; });
    }
  };

  // ─── Helpers ────────────────────────────────────────────────
  const formatPrice = (p: number | null) => p != null ? `$${p.toFixed(2)}` : '—';
  const formatChange = (c: number | null, cp: number | null): { text: string; color: string } => {
    if (c == null || cp == null) return { text: '—', color: '#e2e8f0' };
    const sign = c >= 0 ? '+' : '';
    return {
      text: `${sign}${c.toFixed(2)} (${sign}${cp.toFixed(2)}%)`,
      color: c >= 0 ? '#22c55e' : '#ef4444',
    };
  };

  // ─── Auth loading guard ──────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCcw size={24} style={{ color: '#06b6d4', marginBottom: 8, animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: 13 }}>Loading...</div>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        Please sign in to view your watchlists.
      </div>
    );
  }

  return (
    <div style={{ height: '100dvh', overflowY: 'auto', padding: '12px 16px 120px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Watchlists</h1>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {watchlists.length} list{watchlists.length !== 1 ? 's' : ''} · {watchlists.reduce((sum, w) => sum + (w.stocks?.length || 0), 0)} stocks
          </div>
        </div>
        <button
          onClick={() => { setShowCreate(true); setError(null); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            background: '#06b6d4', color: '#0f172a', border: 'none', borderRadius: 8,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={14} /> New List
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={loadWatchlists} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          Loading watchlists...
        </div>
      )}

      {/* Empty state */}
      {!loading && watchlists.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        }}>
          <Star size={40} style={{ color: '#94a3b8', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No watchlists yet</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Create your first watchlist to track stocks</div>
          <button onClick={() => setShowCreate(true)} style={{
            padding: '10px 20px', borderRadius: 8, background: '#06b6d4',
            color: '#0f172a', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            <Plus size={14} style={{ marginRight: 6 }} />
            Create Watchlist
          </button>
        </div>
      )}

      {/* Watchlist cards */}
      {watchlists.map(wl => (
        <div key={wl.id} style={{ marginBottom: 8 }}>
          <div
            onClick={() => handleExpand(wl)}
            className="watchlist-card"
            style={{ cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: wl.isDefault ? 'rgba(6,182,212,0.15)' : 'rgba(100,116,139,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Star size={16} style={{ color: wl.isDefault ? '#06b6d4' : '#64748b' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {wl.name}
                  {wl.isDefault && (
                    <span style={{ fontSize: 9, background: 'rgba(6,182,212,0.15)', color: '#06b6d4', padding: '1px 6px', borderRadius: 4 }}>DEFAULT</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {wl.stocks?.length || 0} stocks · {wl.description || 'No description'} · Created {new Date(wl.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Quick actions */}
              <button onClick={(e) => { e.stopPropagation(); setEditing(wl); }} style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', padding: 4 }}>
                <Edit3 size={14} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setDeleting(wl); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}>
                <Trash2 size={14} />
              </button>
              {expandedId === wl.id ? <ChevronDown size={16} style={{ color: '#e2e8f0' }} /> : <ChevronRight size={16} style={{ color: '#e2e8f0' }} />}
            </div>
          </div>

          {/* Expanded stocks list */}
          {expandedId === wl.id && (
            <div className="expanded-panel">
              {/* Add stock row with autocomplete */}
              <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderBottom: '1px solid #0f172a' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="text"
                    value={addingSymbol}
                    onChange={(e) => {
                      setAddingSymbol(e.target.value.toUpperCase());
                      setAddError(null);
                      if (addingSymbolTimer.current) clearTimeout(addingSymbolTimer.current);
                      addingSymbolTimer.current = setTimeout(() => fetchAddSuggestions(e.target.value), 200);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && addingSymbol.trim()) {
                        // If exactly one suggestion, use it
                        if (addSuggestions.length === 1) {
                          setAddingSymbol(addSuggestions[0].symbol);
                          setAddSuggestions([]);
                        }
                        handleAddStock();
                      }
                    }}
                    placeholder="Add symbol (e.g. AAPL)..."
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 6,
                      background: '#0f172a', border: '1px solid #334155',
                      color: '#e2e8f0', fontSize: 12, outline: 'none',
                    }}
                  />
                  {/* Add autocomplete dropdown */}
                  {addSuggestions.length > 0 && addingSymbol.length > 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0,
                      background: '#1e293b', border: '1px solid #334155', borderRadius: '0 0 6px 6px',
                      zIndex: 10, maxHeight: 160, overflowY: 'auto',
                    }}>
                      {addSuggestions.map(s => (
                        <div
                          key={s.symbol}
                          onClick={() => {
                            setAddingSymbol(s.symbol);
                            setAddSuggestions([]);
                          }}
                          style={{
                            padding: '8px 12px', cursor: 'pointer',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            borderBottom: '1px solid #0f172a',
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{s.symbol}</span>
                          <span style={{ color: '#e2e8f0', fontSize: 10, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleAddStock}
                  disabled={!addingSymbol.trim()}
                  style={{
                    padding: '8px 12px', borderRadius: 6, background: '#06b6d4', color: '#0f172a',
                    border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    opacity: addingSymbol.trim() ? 1 : 0.4,
                  }}
                >
                  Add
                </button>
              </div>
              {addError && (
                <div style={{ padding: '6px 12px', fontSize: 10, color: '#fca5a5', background: 'rgba(239,68,68,0.08)' }}>{addError}</div>
              )}

              {/* Stock rows */}
              {(!wl.stocks || wl.stocks.length === 0) && (
                <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                  No stocks in this list. Add one above.
                </div>
              )}
              {(wl.stocks || []).map(stock => {
                const q = quotes[stock.symbol];
                const chg = formatChange(q?.change ?? null, q?.changePercent ?? null);
                const Icon = q?.change != null ? (q.change >= 0 ? TrendingUp : TrendingDown) : Minus;
                return (
                  <div key={stock.symbol} className="stock-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <Icon size={12} style={{ color: chg.color }} />
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{stock.symbol}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        <Clock size={10} style={{ marginRight: 2 }} />
                        {new Date(stock.addedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {quotesLoading ? (
                        <RefreshCcw size={12} style={{ color: '#e2e8f0', animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {formatPrice(q?.price ?? null)}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: chg.color, fontVariantNumeric: 'tabular-nums', minWidth: 90, textAlign: 'right' }}>
                            {chg.text}
                          </span>
                        </>
                      )}
                      <button
                        onClick={() => handleRemoveStock(stock.symbol)}
                        style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', padding: 2 }}
                        title="Remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* ─── Create Modal ─────────────────────────────────────── */}
      {showCreate && (
        <WatchlistFormModal
          title="Create Watchlist"
          onSave={handleCreate}
          onClose={() => { setShowCreate(false); setCreateError(null); }}
          saving={creating}
          error={createError}
        />
      )}

      {/* ─── Edit Modal ──────────────────────────────────────── */}
      {editing && (
        <WatchlistFormModal
          title="Edit Watchlist"
          initialName={editing.name}
          initialDescription={editing.description || ''}
          onSave={handleUpdate}
          onClose={() => { setEditing(null); setEditingError(null); }}
          saving={saving}
          error={editingError}
        />
      )}

      {/* ─── Delete Confirm Modal ─────────────────────────────── */}
      {deleting && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, maxWidth: 360, width: '100%', padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete &quot;{deleting.name}&quot;?</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              This will permanently delete this watchlist and all {deleting.stocks?.length || 0} stocks in it. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleting(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, background: 'transparent', border: '1px solid #475569', color: 'var(--text-dim)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDelete} style={{ flex: 1, padding: '10px 0', borderRadius: 8, background: '#ef4444', color: 'white', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .watchlist-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: background 0.15s;
        }
        .watchlist-card:hover { background: #273449; }
        .expanded-panel {
          background: #111827;
          border: 1px solid #334155;
          border-top: none;
          border-radius: 0 0 10px 10px;
          overflow: hidden;
        }
        .stock-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid #0f172a;
        }
        .stock-row:last-child { border-bottom: none; }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── Form Modal (used for both create & edit) ─────────────────
function WatchlistFormModal({
  title,
  initialName = '',
  initialDescription = '',
  onSave,
  onClose,
  saving = false,
  error = null,
}: {
  title: string;
  initialName?: string;
  initialDescription?: string;
  onSave: (name: string, description: string, symbols: string[]) => void;
  onClose: () => void;
  saving?: boolean;
  error?: string | null;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [symbolInput, setSymbolInput] = useState('');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ symbol: string; name: string }>>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsTimer = useRef<NodeJS.Timeout | null>(null);

  // ── Symbol autocomplete ─────────────────────────────────────
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 1) { setSuggestions([]); return; }
    setSuggestionsLoading(true);
    try {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(query.toUpperCase())}`);
      if (res.ok) {
        const data = await res.json();
        // data is { results: [{ symbol, name }] }
        const items = (data.results || []).slice(0, 6);
        setSuggestions(items);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  const handleSymbolInput = (value: string) => {
    setSymbolInput(value);
    if (suggestionsTimer.current) clearTimeout(suggestionsTimer.current);
    suggestionsTimer.current = setTimeout(() => fetchSuggestions(value), 200);
  };

  const addSymbol = (sym: string) => {
    const upper = sym.toUpperCase();
    if (!symbols.includes(upper)) {
      setSymbols(prev => [...prev, upper]);
    }
    setSymbolInput('');
    setSuggestions([]);
  };

  const removeSymbol = (sym: string) => {
    setSymbols(prev => prev.filter(s => s !== sym));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, maxWidth: 420, width: '100%', maxHeight: '90dvh', overflowY: 'auto', padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{title}</div>

        {/* Name */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Tech Stocks"
            autoFocus
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What are you tracking?"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Initial stocks (create only) */}
        {title.startsWith('Create') && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
              Stocks {symbols.length > 0 && `(${symbols.length})`}
            </label>

            {/* Added symbols as chips */}
            {symbols.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {symbols.map(sym => (
                  <span key={sym} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px', borderRadius: 6,
                    background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)',
                    fontSize: 11, fontWeight: 600, color: '#22d3ee',
                  }}>
                    {sym}
                    <button onClick={() => removeSymbol(sym)} style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Symbol input with autocomplete */}
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={symbolInput}
                onChange={(e) => handleSymbolInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && symbolInput.trim()) {
                    e.preventDefault();
                    // If there's exactly one suggestion, use it; otherwise add raw input
                    if (suggestions.length === 1) {
                      addSymbol(suggestions[0].symbol);
                    } else {
                      addSymbol(symbolInput);
                    }
                  }
                }}
                placeholder="Add symbols (e.g. AAPL)..."
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  background: '#1e293b', border: '1px solid #334155',
                  color: '#e2e8f0', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                }}
              />

              {/* Autocomplete dropdown */}
              {(suggestions.length > 0 || suggestionsLoading) && symbolInput.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: '#1e293b', border: '1px solid #334155', borderRadius: '0 0 8px 8px',
                  zIndex: 10, maxHeight: 180, overflowY: 'auto',
                }}>
                  {suggestionsLoading ? (
                    <div style={{ padding: '10px 12px', fontSize: 11, color: '#e2e8f0' }}>Searching...</div>
                  ) : (
                    suggestions.map(s => (
                      <div
                        key={s.symbol}
                        onClick={() => addSymbol(s.symbol)}
                        style={{
                          padding: '8px 12px', cursor: 'pointer',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          borderBottom: '1px solid #0f172a',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{s.symbol}</span>
                        <span style={{ color: '#e2e8f0', fontSize: 10, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: 12, marginBottom: 14,
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: '10px 0', borderRadius: 8, background: 'transparent', border: '1px solid #475569', color: 'var(--text-dim)', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => onSave(name, description, symbols)}
            disabled={!name.trim() || saving}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, background: '#06b6d4', color: '#0f172a', border: 'none', fontSize: 13, fontWeight: 600, cursor: (!name.trim() || saving) ? 'default' : 'pointer', opacity: name.trim() && !saving ? 1 : 0.4 }}
          >
            {saving ? 'Creating...' : title.startsWith('Create') ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
