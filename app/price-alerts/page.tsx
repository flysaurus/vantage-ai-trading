'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  getAlerts, createAlert, updateAlert, deleteAlert,
  type Alert, type AlertType, type NotificationChannel,
} from '@/lib/supabase/alerts';
import {
  ArrowLeft, Plus, Bell, BellOff, Trash2, RefreshCcw,
  TrendingUp, TrendingDown, Activity, X,
} from 'lucide-react';

// ─── Alert Type Labels ────────────────────────────────────────
const ALERT_TYPE_LABELS: Record<AlertType, { label: string; icon: typeof TrendingUp; template: (symbol: string, value: number) => string }> = {
  price_above: {
    label: 'Price goes above',
    icon: TrendingUp,
    template: (s, v) => `${s} above $${v.toFixed(2)}`,
  },
  price_below: {
    label: 'Price goes below',
    icon: TrendingDown,
    template: (s, v) => `${s} below $${v.toFixed(2)}`,
  },
  percent_change: {
    label: 'Price changes by',
    icon: Activity,
    template: (s, v) => `${s} moves ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
  },
};

// ─── Alert Type Options for Dropdown ──────────────────────────
const ALERT_TYPES: { value: AlertType; label: string; hint: string }[] = [
  { value: 'price_above', label: 'Price Above', hint: 'e.g. $200.00' },
  { value: 'price_below', label: 'Price Below', hint: 'e.g. $150.00' },
  { value: 'percent_change', label: '% Change', hint: 'e.g. 5.0%' },
];

// ─── Page ─────────────────────────────────────────────────────
export default function PriceAlertsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<Alert | null>(null);

  // ─── Load alerts ──────────────────────────────────────────
  const loadAlerts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAlerts(user.id);
      setAlerts(data);
    } catch {
      setError('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) loadAlerts(); }, [loadAlerts, user]);

  // ─── Toggle active/inactive ───────────────────────────────
  const handleToggle = async (alert: Alert) => {
    const newActive = !alert.isActive;
    // Optimistic update
    setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, isActive: newActive } : a));
    const result = await updateAlert(alert.id, { isActive: newActive });
    if (!result) {
      // Revert on failure
      setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, isActive: alert.isActive } : a));
    }
  };

  // ─── Delete alert ─────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleting) return;
    setAlerts(prev => prev.filter(a => a.id !== deleting.id));
    const ok = await deleteAlert(deleting.id);
    if (!ok) {
      setAlerts(prev => [...prev, deleting]);
    }
    setDeleting(null);
  };

  // ─── Create alert ─────────────────────────────────────────
  const handleCreate = async (symbol: string, alertType: AlertType, targetValue: number, channels: NotificationChannel[]) => {
    if (!user || !symbol.trim()) return;
    const result = await createAlert({
      userId: user.id,
      symbol: symbol.trim().toUpperCase(),
      alertType,
      targetValue,
      notificationChannels: channels,
    });
    if (result) {
      setAlerts(prev => [result, ...prev]);
      setShowCreate(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────
  const filteredAlerts = alerts.filter(a => {
    if (filter === 'active') return a.isActive;
    if (filter === 'inactive') return !a.isActive;
    return true;
  });

  const activeCount = alerts.filter(a => a.isActive).length;

  // ─── Auth guard ───────────────────────────────────────────
  if (authLoading) {
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
        Please sign in to view your price alerts.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 120px', minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Price Alerts</h1>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {activeCount} active · {alerts.length - activeCount} inactive
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            background: '#06b6d4', color: '#0f172a', border: 'none', borderRadius: 8,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Plus size={14} /> New Alert
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['all', 'active', 'inactive'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px', borderRadius: 6,
              background: filter === f ? '#06b6d4' : '#1e293b',
              color: filter === f ? '#0f172a' : 'var(--text-dim)',
              border: '1px solid transparent',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {f === 'all' && `All (${alerts.length})`}
            {f === 'active' && `Active (${alerts.filter(a => a.isActive).length})`}
            {f === 'inactive' && `Inactive (${alerts.filter(a => !a.isActive).length})`}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={loadAlerts} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          Loading alerts...
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredAlerts.length === 0 && !error && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
        }}>
          <Bell size={40} style={{ color: '#475569', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            {filter === 'all' ? 'No price alerts yet' : `No ${filter} alerts`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
            Get notified when a stock hits your price target
          </div>
          <button onClick={() => setShowCreate(true)} style={{
            padding: '10px 20px', borderRadius: 8, background: '#06b6d4',
            color: '#0f172a', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            <Plus size={14} style={{ marginRight: 6 }} />
            Create Alert
          </button>
        </div>
      )}

      {/* Alert cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredAlerts.map(alert => {
          const typeConfig = ALERT_TYPE_LABELS[alert.alertType];
          const Icon = typeConfig.icon;
          const description = typeConfig.template(alert.symbol, alert.targetValue);
          const isTriggered = !!alert.triggeredAt;

          return (
            <div
              key={alert.id}
              className="alert-card"
              style={{ opacity: alert.isActive ? 1 : 0.55 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Icon */}
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: alert.isActive
                    ? (isTriggered ? 'rgba(34,197,94,0.12)' : 'rgba(6,182,212,0.12)')
                    : 'rgba(100,116,139,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {alert.isActive
                    ? <Icon size={18} style={{ color: isTriggered ? '#22c55e' : '#06b6d4' }} />
                    : <BellOff size={18} style={{ color: '#64748b' }} />
                  }
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '-0.5px' }}>
                      {alert.symbol}
                    </span>
                    {isTriggered && (
                      <span style={{ fontSize: 9, background: 'rgba(34,197,94,0.15)', color: '#22c55e', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                        TRIGGERED
                      </span>
                    )}
                    {!alert.isActive && (
                      <span style={{ fontSize: 9, background: 'rgba(100,116,139,0.15)', color: '#64748b', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                        PAUSED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {description}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{ALERT_TYPE_LABELS[alert.alertType].label} · Created {new Date(alert.createdAt).toLocaleDateString()}</span>
                    {alert.triggeredAt && <span>· Triggered {new Date(alert.triggeredAt).toLocaleDateString()}</span>}
                    {/* Notification channels */}
                    {alert.notificationChannels && alert.notificationChannels.length > 0 && (
                      <span style={{ color: '#64748b' }}>
                        {alert.notificationChannels.map(c =>
                          c === 'email' ? '✉️' : c === 'sms' ? '📱' : c === 'telegram' ? '💬' : ''
                        ).filter(Boolean).join(' ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {/* Toggle switch */}
                  <button
                    onClick={() => handleToggle(alert)}
                    className="toggle-switch"
                    style={{
                      width: 40, height: 22, borderRadius: 11,
                      background: alert.isActive ? '#06b6d4' : '#334155',
                      border: 'none', cursor: 'pointer', position: 'relative',
                      transition: 'background 0.2s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: alert.isActive ? 21 : 3,
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.2s',
                    }} />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => setDeleting(alert)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Create Alert Modal ──────────────────────────────── */}
      {showCreate && (
        <CreateAlertModal
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* ─── Delete Confirm Modal ─────────────────────────────── */}
      {deleting && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, maxWidth: 360, width: '100%', padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete alert?</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
              {ALERT_TYPE_LABELS[deleting.alertType].template(deleting.symbol, deleting.targetValue)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
              This alert will be permanently removed.
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
        .alert-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 12px;
          transition: background 0.15s;
        }
        .alert-card:hover { background: #273449; }
        .toggle-switch:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}

// ─── Create Alert Modal ───────────────────────────────────────
function CreateAlertModal({
  onSave,
  onClose,
}: {
  onSave: (symbol: string, alertType: AlertType, targetValue: number, channels: NotificationChannel[]) => void;
  onClose: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [alertType, setAlertType] = useState<AlertType>('price_above');
  const [targetValue, setTargetValue] = useState('');
  const [channels, setChannels] = useState<NotificationChannel[]>(['in_app']);
  const [error, setError] = useState<string | null>(null);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<Array<{ symbol: string; name: string; price?: number; changePercent?: number }>>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsTimer = useRef<NodeJS.Timeout | null>(null);

  // Selected stock info (fetched when symbol locked in)
  const [stockInfo, setStockInfo] = useState<{ price: number; change: number; changePercent: number; high52w: number; low52w: number } | null>(null);
  const [stockInfoLoading, setStockInfoLoading] = useState(false);

  const selectedSymbolRef = useRef<string | null>(null);

  // ── Fetch suggestions ──────────────────────────────────────
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 1) { setSuggestions([]); setShowSuggestions(false); return; }
    setSuggestionsLoading(true);
    try {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(query.toUpperCase())}`);
      if (res.ok) {
        const data = await res.json();
        const items = (data.results || []).slice(0, 8);
        setSuggestions(items);
        setShowSuggestions(items.length > 0);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  // ── Debounced input handler ────────────────────────────────
  const handleSymbolChange = (value: string) => {
    const upper = value.toUpperCase();
    setSymbol(upper);
    setError(null);
    
    // If user clears or changes from selected symbol, reset
    if (upper !== selectedSymbolRef.current) {
      setStockInfo(null);
      selectedSymbolRef.current = null;
    }

    if (suggestionsTimer.current) clearTimeout(suggestionsTimer.current);
    suggestionsTimer.current = setTimeout(() => fetchSuggestions(upper), 200);
  };

  // ── Select symbol from dropdown / Enter ────────────────────
  const selectSymbol = async (sym: string) => {
    setSymbol(sym);
    setShowSuggestions(false);
    setSuggestions([]);
    
    // Already loaded for this symbol?
    if (selectedSymbolRef.current === sym && stockInfo) return;
    
    // Fetch snapshot for price + 52w range
    setStockInfoLoading(true);
    selectedSymbolRef.current = sym;
    try {
      const res = await fetch(`/api/alpaca/market?symbols=${encodeURIComponent(sym)}`);
      if (res.ok) {
        const data = await res.json();
        const quote = data?.quotes?.[sym];
        if (quote) {
          setStockInfo({
            price: quote.last || quote.ask || 0,
            change: quote.change || 0,
            changePercent: quote.changePercent || 0,
            high52w: quote.high52w || 0,
            low52w: quote.low52w || 0,
          });
        }
      }
    } catch {
      // Non-critical
    } finally {
      setStockInfoLoading(false);
    }
  };

  const handleSubmit = () => {
    setError(null);
    if (!symbol.trim()) { setError('Enter a stock symbol'); return; }
    const value = parseFloat(targetValue);
    if (isNaN(value) || value <= 0) { setError('Enter a valid target value'); return; }
    if (alertType === 'percent_change' && value > 100) { setError('Percentage should be 0–100'); return; }
    onSave(symbol, alertType, value, channels);
  };

  const typeConfig = ALERT_TYPES.find(t => t.value === alertType);
  const valueLabel = alertType === 'percent_change' ? 'Percent' : 'Price ($)';
  const valuePlaceholder = alertType === 'percent_change' ? '5.0' : stockInfo ? stockInfo.price.toFixed(2) : '200.00';

  // Detect if alert is on the right side of market
  const alertWarnings = alertType === 'price_above' && stockInfo && stockInfo.price
    ? targetValue && parseFloat(targetValue) < stockInfo.price 
      ? '⚠ Price above is below current price — alert may trigger immediately'
      : null
    : alertType === 'price_below' && stockInfo && stockInfo.price
    ? targetValue && parseFloat(targetValue) > stockInfo.price
      ? '⚠ Price below is above current price — alert may trigger immediately'
      : null
    : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, maxWidth: 420, width: '100%', padding: 24, maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Create Price Alert</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 2 }}>
            <X size={18} />
          </button>
        </div>

        {/* Symbol */}
        <div style={{ marginBottom: 14, position: 'relative' }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Symbol *</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (showSuggestions && suggestions.length > 0 && suggestions[0].symbol === symbol) {
                  // Exact match in suggestions — select it
                  selectSymbol(symbol);
                } else {
                  handleSubmit();
                }
              } else if (e.key === 'Escape') {
                setShowSuggestions(false);
              }
            }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            onBlur={() => { setTimeout(() => setShowSuggestions(false), 150); }}
            placeholder="Search symbol (e.g. AAPL)"
            autoFocus
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace', outline: 'none' }}
          />
          
          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 101,
              background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
              maxHeight: 240, overflowY: 'auto', marginTop: 2,
            }}>
              {suggestions.map((s, i) => (
                <div
                  key={s.symbol}
                  onMouseDown={() => selectSymbol(s.symbol)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderBottom: i < suggestions.length - 1 ? '1px solid #1e293b' : 'none',
                    background: s.symbol === symbol ? '#0f3460' : 'transparent',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{s.symbol}</span>
                    <span style={{ fontSize: 10, color: '#64748b', marginLeft: 8 }}>{s.name?.substring(0, 35)}{s.name?.length > 35 ? '…' : ''}</span>
                  </div>
                  {s.price != null && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#06b6d4', fontVariantNumeric: 'tabular-nums' }}>
                      ${s.price.toFixed(2)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {suggestionsLoading && (
            <div style={{ position: 'absolute', right: 8, top: 34, color: '#64748b' }}>
              <RefreshCcw size={12} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}
        </div>

        {/* Stock info card — shows when symbol selected */}
        {stockInfo && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', borderRadius: 8,
            background: '#111b2e', border: '1px solid #1e3a5f',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Current Price</div>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
                ${stockInfo.price.toFixed(2)}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 600, marginLeft: 8,
                color: stockInfo.change >= 0 ? '#10b981' : '#ef4444',
              }}>
                {stockInfo.change >= 0 ? '+' : ''}{stockInfo.change.toFixed(2)} ({stockInfo.changePercent >= 0 ? '+' : ''}{stockInfo.changePercent.toFixed(2)}%)
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>52-Week Range</div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                ${stockInfo.low52w.toFixed(2)} – ${stockInfo.high52w.toFixed(2)}
              </span>
            </div>
          </div>
        )}
        {stockInfoLoading && (
          <div style={{ marginBottom: 14, padding: 10, textAlign: 'center', color: '#64748b', fontSize: 11 }}>
            <RefreshCcw size={12} style={{ animation: 'spin 1s linear infinite', marginRight: 6, display: 'inline-block', verticalAlign: 'middle' }} />
            Loading {symbol}...
          </div>
        )}

        {/* Alert Type */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Alert Type</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {ALERT_TYPES.map(t => {
              const Icon = ALERT_TYPE_LABELS[t.value].icon;
              const selected = alertType === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => { setAlertType(t.value); setTargetValue(''); setError(null); }}
                  style={{
                    padding: '10px 8px', borderRadius: 8,
                    background: selected ? '#06b6d4' : '#1e293b',
                    border: selected ? '1px solid #06b6d4' : '1px solid #334155',
                    color: selected ? '#0f172a' : 'var(--text-dim)',
                    cursor: 'pointer', textAlign: 'center',
                    fontSize: 11, fontWeight: selected ? 700 : 500,
                  }}
                >
                  <Icon size={14} style={{ display: 'block', margin: '0 auto 4px', color: selected ? '#0f172a' : '#64748b' }} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notification Channels */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
            Notify via
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            {([
              { id: 'in_app' as NotificationChannel, label: '📱 In-App', alwaysOn: true },
              { id: 'email' as NotificationChannel, label: '✉️ Email' },
            ]).map(ch => (
              <label
                key={ch.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  background: channels.includes(ch.id) ? '#0f3460' : '#1e293b',
                  border: channels.includes(ch.id) ? '1px solid #3b82f6' : '1px solid #334155',
                  fontSize: 12, color: '#e2e8f0',
                  opacity: ch.alwaysOn ? 1 : undefined,
                }}
              >
                <input
                  type="checkbox"
                  checked={channels.includes(ch.id)}
                  disabled={ch.alwaysOn}
                  onChange={() => {
                    if (ch.alwaysOn) return;
                    setChannels(prev =>
                      prev.includes(ch.id)
                        ? prev.filter(c => c !== ch.id)
                        : [...prev, ch.id]
                    );
                  }}
                  style={{ accentColor: '#3b82f6' }}
                />
                {ch.label}
              </label>
            ))}
          </div>
        </div>

        {/* Target Value */}
        <div style={{ marginBottom: error || alertWarnings ? 8 : 20 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            {valueLabel} *
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>
              {alertType === 'percent_change' ? '%' : '$'}
            </span>
            <input
              type="number"
              value={targetValue}
              onChange={(e) => { setTargetValue(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder={valuePlaceholder}
              step="0.01"
              min="0"
              style={{
                width: '100%', padding: '10px 12px 10px 28px', borderRadius: 8,
                background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                fontSize: 13, outline: 'none', fontVariantNumeric: 'tabular-nums',
              }}
            />
          </div>
          {/* Price reference hint */}
          {stockInfo && alertType !== 'percent_change' && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: 6, fontSize: 10, color: 'var(--text-muted)',
            }}>
              <span>
                Current: <strong style={{ color: '#94a3b8' }}>${stockInfo.price.toFixed(2)}</strong>
                {stockInfo.low52w > 0 && stockInfo.high52w > 0 && (
                  <> · 52w: <strong style={{ color: '#94a3b8' }}>${stockInfo.low52w.toFixed(2)} – ${stockInfo.high52w.toFixed(2)}</strong></>
                )}
              </span>
              {alertType === 'price_above' && (
                <span>Alert if {'>'} ${targetValue || '…'}</span>
              )}
              {alertType === 'price_below' && (
                <span>Alert if {'<'} ${targetValue || '…'}</span>
              )}
            </div>
          )}
          {typeConfig && !stockInfo && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{typeConfig.hint}</div>
          )}
        </div>

        {/* Alert warning */}
        {alertWarnings && (
          <div style={{
            marginBottom: 12, padding: '6px 10px', borderRadius: 6,
            background: '#422316', border: '1px solid #854d0e',
            fontSize: 10, color: '#fbbf24',
          }}>
            {alertWarnings}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontSize: 11 }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 8, background: 'transparent', border: '1px solid #475569', color: 'var(--text-dim)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!symbol.trim() || !targetValue}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, background: '#06b6d4', color: '#0f172a', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (symbol.trim() && targetValue) ? 1 : 0.4 }}
          >
            Create Alert
          </button>
        </div>
      </div>
    </div>
  );
}
