'use client';
import { useState, useEffect, useRef } from 'react';
import { Search, TrendingUp, TrendingDown } from 'lucide-react';

interface SearchResult {
  symbol: string;
  name?: string;
  exchange?: string;
  price?: number;
  changePercent?: number;
}

interface Props {
  value: string;
  onChange: (symbol: string) => void;
  placeholder?: string;
  positions?: string[];
}

export function SymbolSearch({ value, onChange, placeholder = 'Search symbol...', positions = [] }: Props) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external value
  useEffect(() => { setQuery(value); }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch suggestions
  useEffect(() => {
    if (query.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/alpaca/symbols?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const json = await res.json();
          const items: SearchResult[] = json.results || [];
          setResults(items.slice(0, 12));
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const select = (symbol: string) => {
    setQuery(symbol);
    onChange(symbol);
    setShowDropdown(false);
    setSelectedIdx(-1);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '0 12px' }}>
        <Search size={14} style={{ color: '#94a3b8', marginRight: 8 }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setShowDropdown(true);
            setSelectedIdx(-1);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, -1)); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (selectedIdx >= 0 && results[selectedIdx]) select(results[selectedIdx].symbol);
              else if (query) select(query);
            }
            else if (e.key === 'Escape') setShowDropdown(false);
          }}
          placeholder={placeholder}
          style={{ flex: 1, padding: '10px 0', background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: 13, outline: 'none' }}
        />
        {loading && <span style={{ fontSize: 10, color: '#94a3b8' }}>...</span>}
      </div>

      {/* Quick-select positions */}
      {positions.length > 0 && !query && showDropdown && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6, padding: '0 4px' }}>Your Positions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {positions.map((sym) => (
              <button
                key={sym}
                onClick={() => select(sym)}
                style={{ padding: '4px 8px', fontSize: 11, fontWeight: 600, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#cbd5e1', cursor: 'pointer' }}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search results */}
      {results.length > 0 && showDropdown && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, boxShadow: '0 10px 25px rgba(0,0,0,0.5)', maxHeight: 260, overflow: 'auto' }}>
          {results.map((r, i) => (
            <button
              key={r.symbol}
              onClick={() => select(r.symbol)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                background: i === selectedIdx ? '#334155' : 'transparent',
                border: 'none', borderBottom: i < results.length - 1 ? '1px solid #33415550' : 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <TrendingUp size={14} style={{ color: '#94a3b8' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{r.symbol}</div>
                {r.name && <div style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>}
              </div>
              {r.price != null && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>${r.price.toFixed(2)}</div>
                  {r.changePercent != null && (
                    <div style={{ fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2, color: r.changePercent >= 0 ? '#4ade80' : '#f87171', justifyContent: 'flex-end' }}>
                      {r.changePercent >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {r.changePercent >= 0 ? '+' : ''}{r.changePercent.toFixed(2)}%
                    </div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
