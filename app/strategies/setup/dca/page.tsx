'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, TrendingUp, TrendingDown, Loader2,
  DollarSign, Activity, Layers, Calendar, Clock, Repeat,
} from 'lucide-react';
import { SymbolSearch } from '@/components/trade/SymbolSearch';
import { usePortfolio } from '@/hooks/usePortfolio';

// ─── Types ──────────────────────────────────────────────────
interface StockDetails {
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  marketCap: number | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  high: number | null;
  low: number | null;
  eps: number | null;
  pe: number | null;
  high52w: number | null;
  low52w: number | null;
}

interface DcaSchedule {
  id: string;
  symbol: string;
  config: { amount: number; frequency: string; dayOfWeek?: string; dayOfMonth?: string; startDate: string; endDate?: string; investBy?: string; quantity?: number };
  createdAt: string;
}

type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';
const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
const DAY_LABELS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri' };
const DATES = ['1', '15', 'last'] as const;
const DATE_LABELS: Record<string, string> = { '1': '1st', '15': '15th', last: 'Last day' };

const AMOUNT_CHIPS = [50, 100, 250, 500, 1000];

// ─── Helpers ────────────────────────────────────────────────
function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}
function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Component ──────────────────────────────────────────────
export default function DcaSetupPage() {
  const router = useRouter();
  const { account } = usePortfolio();
  const holdings = account?.positions || [];
  const buyingPower = account?.buyingPower ?? 0;

  // Section 1
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [stockDetails, setStockDetails] = useState<StockDetails | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);

  // Section 2
  const [investBy, setInvestBy] = useState<'amount' | 'shares'>('amount');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [quantity, setQuantity] = useState('');
  const [quantityError, setQuantityError] = useState('');

  // Section 3
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState<string | null>(null);
  const [dayOfMonth, setDayOfMonth] = useState<string | null>(null);

  // Section 4
  const [startDate, setStartDate] = useState(todayStr());
  const [runIndefinitely, setRunIndefinitely] = useState(true);
  const [endDate, setEndDate] = useState('');

  // Section 6
  const [existingSchedules, setExistingSchedules] = useState<DcaSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [editingSchedule, setEditingSchedule] = useState<DcaSchedule | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ─── Load existing schedules ────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/strategies/dca/get-all');
        if (res.ok) {
          const data = await res.json();
          setExistingSchedules(data.schedules || []);
        }
      } catch { /* ignore */ }
      finally { setLoadingSchedules(false); }
    })();
  }, []);

  // ─── Auto-dismiss toast ─────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Symbol Selection ───────────────────────────────────
  const handleSymbolSelect = useCallback(async (symbol: string) => {
    setSelectedSymbol(symbol);
    setStockError(null);
    setLoadingStock(true);
    setStockDetails(null);

    try {
      const res = await fetch(`/api/stock/details?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json();
      if (!res.ok || data.error) { setStockError(data.error || 'Failed to load stock details'); return; }
      if (data.price == null) { setStockError(`No market data available for ${symbol}.`); return; }
      setStockDetails(data);
    } catch { setStockError('Network error. Please try again.'); }
    finally { setLoadingStock(false); }
  }, []);

  // ─── Amount validation ──────────────────────────────────
  const handleAmount = (val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, '');
    setAmount(cleaned);
    const n = parseFloat(cleaned);
    if (cleaned && (isNaN(n) || n < 1)) setAmountError('Minimum $1');
    else if (buyingPower > 0 && n > buyingPower * 0.5) setAmountError('Exceeds 50% of buying power');
    else setAmountError('');
  };

  // ─── Quantity validation ───────────────────────────────
  const handleQuantity = (val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, '');
    setQuantity(cleaned);
    const n = parseFloat(cleaned);
    if (cleaned && (isNaN(n) || n <= 0)) setQuantityError('Enter at least 1 share');
    else if (!Number.isInteger(n) && cleaned.includes('.')) {
      // Allow fractional shares (e.g. 1.5) — but flag as fractional
      if (n < 0.01) setQuantityError('Minimum 0.01 shares');
      else setQuantityError('');
    }
    else setQuantityError('');
  };

  // ─── Edit a schedule (populate form) ───────────────────
  const editSchedule = (sched: DcaSchedule) => {
    setEditingSchedule(sched);
    setSelectedSymbol(sched.symbol);
    handleSymbolSelect(sched.symbol);
    const c = sched.config;
    if (c.investBy === 'shares') {
      setInvestBy('shares');
      setQuantity(String(c.quantity || ''));
    } else {
      setInvestBy('amount');
      setAmount(String(c.amount || ''));
    }
    setFrequency(c.frequency as Frequency);
    setDayOfWeek(c.dayOfWeek || null);
    setDayOfMonth(c.dayOfMonth || null);
    setStartDate(c.startDate || todayStr());
    if (c.endDate) {
      setRunIndefinitely(false);
      setEndDate(c.endDate);
    } else {
      setRunIndefinitely(true);
      setEndDate('');
    }
    // Scroll to top
    window.scrollTo(0, 0);
  };

  // ─── Cancel a schedule ──────────────────────────────────
  const cancelSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/strategies/dca/delete?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setExistingSchedules(prev => prev.filter(s => s.id !== id));
      }
    } catch { /* ignore */ }
  };

  // ─── Submit ─────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const parsedAmount = investBy === 'amount' ? parseFloat(amount) : 0;
      const parsedQty = investBy === 'shares' ? parseFloat(quantity) : 0;
      if (!selectedSymbol || (!parsedAmount && !parsedQty) || !frequency || !startDate) {
        setSubmitting(false);
        return;
      }

      const body: Record<string, any> = {
        symbol: selectedSymbol,
        amount: parsedAmount,
        frequency,
        startDate,
        investBy,
      };
      if (investBy === 'shares') {
        body.quantity = parsedQty;
        body.amount = price ? Math.round(parsedQty * price * 100) / 100 : 0;
      }
      if ((frequency === 'weekly' || frequency === 'biweekly') && dayOfWeek) body.dayOfWeek = dayOfWeek;
      if (frequency === 'monthly' && dayOfMonth) body.dayOfMonth = dayOfMonth;
      if (!runIndefinitely && endDate) body.endDate = endDate;

      const isUpdate = !!editingSchedule;
      const url = isUpdate ? '/api/strategies/dca/update' : '/api/strategies/dca/create';
      const method = isUpdate ? 'PUT' : 'POST';
      if (isUpdate) body.scheduleId = editingSchedule.id;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        setToast(err.error || 'Failed to save schedule');
        return;
      }

      const data = await res.json();
      setToast(`✓ DCA ${isUpdate ? 'updated' : 'scheduled'} for ${selectedSymbol}`);

      // Reload schedules and reset editing
      if (isUpdate) {
        setExistingSchedules(prev => prev.map(s => s.id === editingSchedule.id ? { ...s, symbol: selectedSymbol, config: { ...s.config, ...body } } : s));
        setEditingSchedule(null);
      } else {
        setTimeout(() => router.back(), 1200);
      }
    } catch {
      setToast('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Derived values for preview ─────────────────────────
  const price = stockDetails?.price ?? null;
  const isAmountMode = investBy === 'amount';
  const isSharesMode = investBy === 'shares';
  const effectiveAmount = isAmountMode ? parseFloat(amount) : (price && parseFloat(quantity) ? parseFloat(quantity) * price : 0);
  const estShares = price && parseFloat(amount) && isAmountMode ? (parseFloat(amount) / price).toFixed(4) : null;
  const estCost = price && parseFloat(quantity) && isSharesMode ? `$${(parseFloat(quantity) * price).toFixed(2)}` : null;

  const monthsRunning = (() => {
    const start = new Date(startDate + 'T00:00:00');
    const endRaw = runIndefinitely ? null : endDate;
    const end = endRaw ? new Date(endRaw + 'T00:00:00') : new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000); // default: 1 year
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000)));
  })();

  const totalInvested = effectiveAmount > 0 ? `$${(effectiveAmount * getEstimatedOrderCount(frequency, monthsRunning)).toFixed(2)}` : null;

  function getEstimatedOrderCount(freq: Frequency | null, months: number): number {
    if (!freq) return 0;
    switch (freq) {
      case 'daily': return Math.floor(months * 21); // ~21 trading days/month
      case 'weekly': return Math.floor(months * 4.33);
      case 'biweekly': return Math.floor(months * 2.17);
      case 'monthly': return months;
    }
  }

  const estOrders = getEstimatedOrderCount(frequency, monthsRunning);

  const canSubmit = selectedSymbol && ((isAmountMode && parseFloat(amount) >= 1 && !amountError) || (isSharesMode && parseFloat(quantity) >= 0.01 && !quantityError)) && frequency && startDate;

  const position = holdings.find(p => p.symbol === selectedSymbol);
  const changeColor = (stockDetails?.changePercent ?? 0) >= 0 ? '#4ade80' : '#f87171';

  // ─── Render ─────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#0f172a', color: '#f1f5f9', padding: '16px 16px 180px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, animation: 'dcaToastIn 0.25s ease-out' }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#f1f5f9', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 18px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</span>
        </div>
      )}

      {/* ─── Header ───────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button onClick={() => router.push('/strategies')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#06b6d4', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            View strategies →
          </button>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Dollar Cost Averaging</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Automate recurring investments</p>
      </div>

      {/* ─── Section 1: Stock Selection ─────────────── */}
      <Section icon={<Layers size={12} />} label="Stock Selection">
        <SymbolSearch value={selectedSymbol} onChange={handleSymbolSelect} placeholder="Search for a stock or ETF..." positions={holdings.map(p => p.symbol)} />
        {loadingStock && <Spinner label={`Loading ${selectedSymbol}...`} />}
        {stockError && <ErrorBox message={stockError} />}
        {stockDetails && <StockCard details={stockDetails} changeColor={changeColor} position={position} />}
      </Section>

      {/* ─── Section 2: Investment Amount ───────────── */}
      <Section icon={<DollarSign size={12} />} label="How much per investment?">
        {/* Amount vs Shares toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {(['amount', 'shares'] as const).map(mode => (
            <button key={mode} onClick={() => { setInvestBy(mode); setAmountError(''); setQuantityError(''); }} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 9999, border: '1px solid #334155', background: investBy === mode ? '#06b6d4' : '#1e293b', color: investBy === mode ? '#0f172a' : '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit' }}>
              {mode === 'amount' ? '💵 Dollar Amount' : '📊 Shares'}
            </button>
          ))}
        </div>

        {isAmountMode ? (
          <>
            <input type="text" inputMode="decimal" value={amount} onChange={e => handleAmount(e.target.value)} placeholder="$0" style={{ width: '100%', padding: '12px 14px', background: '#1e293b', border: `1px solid ${amountError ? '#f87171' : '#334155'}`, borderRadius: 8, color: '#f1f5f9', fontSize: 16, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }} />
            {amountError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{amountError}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {AMOUNT_CHIPS.map(c => (
                <button key={c} onClick={() => { setAmount(c.toString()); setAmountError(''); }} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 9999, border: '1px solid #334155', background: amount === c.toString() ? '#06b6d4' : '#1e293b', color: amount === c.toString() ? '#0f172a' : '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit' }}>
                  ${c}
                </button>
              ))}
            </div>
            {price && parseFloat(amount) >= 1 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
                ≈ <strong style={{ color: '#e2e8f0' }}>{(parseFloat(amount) / price).toFixed(4)}</strong> shares at {fmtCurrency(price)}
              </div>
            )}
          </>
        ) : (
          <>
            <input type="text" inputMode="decimal" value={quantity} onChange={e => handleQuantity(e.target.value)} placeholder="0" style={{ width: '100%', padding: '12px 14px', background: '#1e293b', border: `1px solid ${quantityError ? '#f87171' : '#334155'}`, borderRadius: 8, color: '#f1f5f9', fontSize: 16, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }} />
            {quantityError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{quantityError}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {[1, 5, 10, 25, 50].map(n => (
                <button key={n} onClick={() => { setQuantity(n.toString()); setQuantityError(''); }} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 9999, border: '1px solid #334155', background: quantity === n.toString() ? '#06b6d4' : '#1e293b', color: quantity === n.toString() ? '#0f172a' : '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {n} shares
                </button>
              ))}
            </div>
            {price && parseFloat(quantity) >= 0.01 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
                ≈ <strong style={{ color: '#e2e8f0' }}>{fmtCurrency(parseFloat(quantity) * price)}</strong> at {fmtCurrency(price)}/share
              </div>
            )}
          </>
        )}
      </Section>

      {/* ─── Section 3: Frequency ───────────────────── */}
      <Section icon={<Repeat size={12} />} label="How often?">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FREQUENCIES.map(f => (
            <button key={f.value} onClick={() => { setFrequency(f.value); setDayOfWeek(null); setDayOfMonth(null); }} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 9999, border: '1px solid #334155', background: frequency === f.value ? '#06b6d4' : '#1e293b', color: frequency === f.value ? '#0f172a' : '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit' }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Day of week selector */}
        {(frequency === 'weekly' || frequency === 'biweekly') && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>On which day?</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {DAYS.map(d => (
                <button key={d} onClick={() => setDayOfWeek(d)} style={{ flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #334155', background: dayOfWeek === d ? '#06b6d4' : '#1e293b', color: dayOfWeek === d ? '#0f172a' : '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {DAY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Day of month selector */}
        {frequency === 'monthly' && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>On which day?</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {DATES.map(d => (
                <button key={d} onClick={() => setDayOfMonth(d)} style={{ flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #334155', background: dayOfMonth === d ? '#06b6d4' : '#1e293b', color: dayOfMonth === d ? '#0f172a' : '#cbd5e1', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {DATE_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ─── Section 4: Schedule ─────────────────────── */}
      <Section icon={<Calendar size={12} />} label="Schedule">
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>Start date</div>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} min={todayStr()} style={{ width: '100%', padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', fontFamily: 'inherit', colorScheme: 'dark' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={() => setRunIndefinitely(!runIndefinitely)} style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${runIndefinitely ? '#06b6d4' : '#475569'}`, background: runIndefinitely ? '#06b6d4' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {runIndefinitely && <span style={{ color: '#0f172a', fontSize: 12, lineHeight: 1 }}>✓</span>}
          </button>
          <span style={{ fontSize: 13, color: '#e2e8f0' }}>Run indefinitely</span>
        </div>

        {!runIndefinitely && (
          <>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>End date</div>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} style={{ width: '100%', padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', fontFamily: 'inherit', colorScheme: 'dark' }} />
            {endDate && estOrders > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
                Estimated orders: <strong style={{ color: '#e2e8f0' }}>{estOrders}</strong>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ─── Section 5: Preview ──────────────────────── */}
      {selectedSymbol && effectiveAmount > 0 && frequency && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            <Clock size={12} style={{ marginRight: 6, display: 'inline' }} />Preview
          </div>
          {isAmountMode && estShares && <PreviewRow label="Est. shares per order" value={`${estShares} @ ${fmtCurrency(price)}`} />}
          {isSharesMode && estCost && <PreviewRow label="Est. cost per order" value={`${estCost} @ ${fmtCurrency(price)}/share`} />}
          {totalInvested && <PreviewRow label={`Total invested (${monthsRunning}mo)`} value={totalInvested} />}
          {!runIndefinitely && endDate && estOrders > 0 && <PreviewRow label="Orders scheduled" value={estOrders.toString()} />}
          {buyingPower > 0 && isAmountMode && parseFloat(amount) > buyingPower * 0.1 && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 6, fontSize: 11, color: '#fbbf24', fontWeight: 600 }}>
              ⚠️ Amount exceeds 10% of buying power (${buyingPower.toFixed(2)})
            </div>
          )}
        </div>
      )}

      {/* ─── Section 6: Existing Schedules ───────────── */}
      <Section icon={<Activity size={12} />} label="Existing DCA Schedules">
        {loadingSchedules ? (
          <Spinner label="Loading schedules..." />
        ) : existingSchedules.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>No active DCA schedules.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {existingSchedules.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#0f172a', border: `1px solid ${editingSchedule?.id === s.id ? '#06b6d4' : '#334155'}`, borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{s.symbol}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {s.config.investBy === 'shares' ? `${s.config.quantity || '?'} shares` : `$${s.config.amount}`} · {s.config.frequency}{s.config.dayOfWeek ? ` (${DAY_LABELS[s.config.dayOfWeek] || s.config.dayOfWeek})` : ''}{s.config.dayOfMonth ? ` (${DATE_LABELS[s.config.dayOfMonth] || s.config.dayOfMonth})` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => editSchedule(s)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: editingSchedule?.id === s.id ? '#06b6d4' : 'none', border: `1px solid ${editingSchedule?.id === s.id ? '#06b6d4' : '#475569'}`, borderRadius: 6, color: editingSchedule?.id === s.id ? '#0f172a' : '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {editingSchedule?.id === s.id ? 'Editing' : 'Edit'}
                  </button>
                  <button onClick={() => cancelSchedule(s.id)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'none', border: '1px solid #475569', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ─── Bottom Bar ──────────────────────────────── */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'linear-gradient(to top, #0f172a 80%, rgba(15,23,42,0.95))', padding: '12px 16px 64px', borderTop: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{ flex: 1, padding: 14, borderRadius: 10, border: 'none', background: canSubmit && !submitting ? 'linear-gradient(135deg, #06b6d4, #0d9488)' : '#334155', color: canSubmit && !submitting ? '#0f172a' : '#64748b', fontSize: 15, fontWeight: 700, cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'all 0.2s ease' }}>
            {submitting ? 'Saving...' : editingSchedule ? 'Update DCA' : 'Schedule DCA'}
          </button>
          <button onClick={() => { if (editingSchedule) { setEditingSchedule(null); setSelectedSymbol(''); setAmount(''); setQuantity(''); setFrequency(null); setDayOfWeek(null); setDayOfMonth(null); setStartDate(todayStr()); setRunIndefinitely(true); setEndDate(''); setStockDetails(null); } else { router.back(); } }} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {editingSchedule ? 'Cancel Edit' : 'Cancel'}
          </button>
        </div>
      </div>

      <style>{`@keyframes dcaToastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────
function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> {label}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ padding: 12, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, color: '#f87171', fontSize: 12, marginBottom: 16 }}>
      {message}
    </div>
  );
}

function StockCard({ details, changeColor, position }: { details: StockDetails; changeColor: string; position: any }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>{details.symbol}</div>
          {details.name && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{details.name}</div>}
        </div>
        {details.sector && <span style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)', borderRadius: 6, padding: '3px 10px' }}>{details.sector}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14, padding: '10px 12px', background: '#0f172a', borderRadius: 8 }}>
        <DollarSign size={14} style={{ color: '#06b6d4' }} />
        <span style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{fmtCurrency(details.price)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 13, fontWeight: 700, color: changeColor }}>
          {details.changePercent != null && (details.changePercent >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />)}
          {details.change != null ? `${details.change >= 0 ? '+' : ''}${fmt(details.change)} (${details.changePercent != null && details.changePercent >= 0 ? '+' : ''}${fmt(details.changePercent)}%)` : '—'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: position ? 14 : 0 }}>
        <Detail label="EPS" value={`$${fmt(details.eps)}`} />
        <Detail label="P/E" value={fmt(details.pe)} />
        <Detail label="52w High" value={fmtCurrency(details.high52w)} />
        <Detail label="52w Low" value={fmtCurrency(details.low52w)} />
      </div>
      {position && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 8 }}>
          <Activity size={14} style={{ color: '#06b6d4' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#06b6d4' }}>Already in portfolio: {position.qty != null ? `${position.qty} shares` : 'held'}</span>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{value}</span>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{value}</span>
    </div>
  );
}
