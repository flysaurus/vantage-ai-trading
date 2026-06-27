'use client';

import { apiGet, apiPost } from '@/lib/api-client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingDown, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Activity, Info } from 'lucide-react';
import { usePortfolioStore } from '@/store';
import { useAuth } from '@/components/providers/AuthProvider';
import { getDemoAccount } from '@/lib/demo-data';

// ─── Types ─────────────────────────────────────────────────
interface Position {
  symbol: string;
  name?: string;
  qty: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPct: number;
  sector?: string;
}

interface HarvestSelection {
  symbol: string;
  qty: number;
  costBasis: number;
  currentPrice: number;
  loss: number;
  lossPct: number;
  estTaxSavings: number;
  replacement?: { symbol: string; name: string; price: number };
}

interface WashSaleStatus {
  symbol: string;
  isSafe: boolean;
  daysSinceLastTrade: number;
  lastTradeDate: string | null;
}

interface TradeSummary {
  realizedGains: number;
  realizedLosses: number;
  netPosition: number;
}

// ─── Replacement Security Mappings ─────────────────────────
const SECTOR_ETF_MAP: Record<string, Array<{ symbol: string; name: string }>> = {
  technology: [
    { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
    { symbol: 'XLK', name: 'Technology Select Sector SPDR' },
  ],
  financial: [
    { symbol: 'XLF', name: 'Financial Select Sector SPDR' },
    { symbol: 'VFH', name: 'Vanguard Financials ETF' },
  ],
  healthcare: [
    { symbol: 'XLV', name: 'Health Care Select Sector SPDR' },
    { symbol: 'VHT', name: 'Vanguard Health Care ETF' },
  ],
  energy: [
    { symbol: 'XLE', name: 'Energy Select Sector SPDR' },
    { symbol: 'VDE', name: 'Vanguard Energy ETF' },
  ],
  'consumer cyclical': [
    { symbol: 'XLY', name: 'Consumer Discretionary SPDR' },
    { symbol: 'VCR', name: 'Vanguard Consumer Disc. ETF' },
  ],
  'consumer defensive': [
    { symbol: 'XLP', name: 'Consumer Staples SPDR' },
    { symbol: 'VDC', name: 'Vanguard Consumer Staples ETF' },
  ],
  industrials: [
    { symbol: 'XLI', name: 'Industrial Select Sector SPDR' },
    { symbol: 'VIS', name: 'Vanguard Industrials ETF' },
  ],
  utilities: [
    { symbol: 'XLU', name: 'Utilities Select Sector SPDR' },
    { symbol: 'VPU', name: 'Vanguard Utilities ETF' },
  ],
  'real estate': [
    { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR' },
    { symbol: 'VNQ', name: 'Vanguard Real Estate ETF' },
  ],
  'communication services': [
    { symbol: 'XLC', name: 'Communication Services SPDR' },
    { symbol: 'VOX', name: 'Vanguard Communication Svcs ETF' },
  ],
  'basic materials': [
    { symbol: 'XLB', name: 'Materials Select Sector SPDR' },
    { symbol: 'VAW', name: 'Vanguard Materials ETF' },
  ],
};

const BROAD_MARKET = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF' },
];

function getReplacementSuggestions(sector?: string): Array<{ symbol: string; name: string }> {
  const key = (sector || '').toLowerCase();
  const sectorEtfs = SECTOR_ETF_MAP[key];
  if (sectorEtfs && sectorEtfs.length > 0) return sectorEtfs;
  return BROAD_MARKET;
}

// ─── Helpers ───────────────────────────────────────────────
function getCurrentYear(): number {
  return new Date().getFullYear();
}

function isYearEnd(): boolean {
  const month = new Date().getMonth(); // 0-indexed
  return month >= 9; // October (9) through December (11)
}

// ─── Page Component ────────────────────────────────────────
export default function TaxHarvestingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const investorStyle = (user?.investorStyle || 'buffett') as import('@/types').InvestorStyle;
  const currentYear = getCurrentYear();
  const showUrgency = isYearEnd();

  // Data state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [tradeSummary, setTradeSummary] = useState<TradeSummary>({ realizedGains: 0, realizedLosses: 0, netPosition: 0 });
  const [isConnected, setIsConnected] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  // UI state
  const [selectedHarvests, setSelectedHarvests] = useState<Record<string, HarvestSelection>>({});
  const [selectedReplacements, setSelectedReplacements] = useState<Record<string, { symbol: string; name: string; price: number }>>({});
  const [washSaleStatuses, setWashSaleStatuses] = useState<Record<string, WashSaleStatus>>({});
  const [showWashRule, setShowWashRule] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');

  // ─── Data Loading ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setLoadError('');

        const portfolioStore = usePortfolioStore.getState();
        const account = portfolioStore.account;

        // Check broker status
        let connected = false;
        try {
          const statusRes = await apiGet('/api/broker/status');
          if (statusRes.ok) {
            const status = await statusRes.json();
            connected = status.connected || status.isConnected || false;
          }
        } catch { /* use demo fallback */ }

        if (cancelled) return;
        setIsConnected(connected);
        setIsDemo(!connected);

        // Load positions
        let posList: Position[] = [];
        let prices: Record<string, { price: number; changePct: number; name?: string }> = {};

        if (connected) {
          // Use real portfolio data from store
          if (account?.positions?.length) {
            const symbols = account.positions.map((p: any) => p.symbol);
            // Fetch live prices
            try {
              const qRes = await await apiPost('/api/market/quotes', { symbols });
              if (qRes.ok) {
                const qData = await qRes.json();
                Object.entries(qData.quotes || qData || {}).forEach(([sym, q]: [string, any]) => {
                  prices[sym] = { price: q.price ?? q.c ?? 0, changePct: q.changePercent ?? q.dp ?? 0 };
                });
              }
            } catch { /* continue */ }

            posList = account.positions.map((p: any) => {
              const price = prices[p.symbol]?.price ?? 0;
              const mktVal = price * p.qty;
              const cost = p.avg_entry_price || p.cost_basis || 0;
              const costTotal = cost * p.qty;
              return {
                symbol: p.symbol,
                name: p.name || p.symbol,
                qty: Number(p.qty) || 0,
                costBasis: costTotal,
                currentPrice: price,
                marketValue: mktVal,
                unrealizedPL: mktVal - costTotal,
                unrealizedPLPct: costTotal > 0 ? ((mktVal - costTotal) / costTotal) * 100 : 0,
              };
            });
          }
        } else {
          // Demo data
          const demoAccount = getDemoAccount(investorStyle, {});
          if (demoAccount?.positions?.length) {
            const symbols = demoAccount.positions.map((p: any) => p.symbol);
            try {
              const qRes = await await apiPost('/api/market/quotes', { symbols });
              if (qRes.ok) {
                const qData = await qRes.json();
                Object.entries(qData.quotes || qData || {}).forEach(([sym, q]: [string, any]) => {
                  prices[sym] = { price: q.price ?? q.c ?? 0, changePct: q.changePercent ?? q.dp ?? 0 };
                });
              }
            } catch { /* continue */ }

            posList = demoAccount.positions.map((p: any) => {
              const price = prices[p.symbol]?.price ?? 0;
              const mktVal = price * p.qty;
              const cost = p.avg_entry_price || p.cost_basis || price * 0.9;
              const costTotal = cost * p.qty;
              return {
                symbol: p.symbol,
                name: p.name || p.symbol,
                qty: Number(p.qty) || 0,
                costBasis: costTotal,
                currentPrice: price,
                marketValue: mktVal,
                unrealizedPL: mktVal - costTotal,
                unrealizedPLPct: costTotal > 0 ? ((mktVal - costTotal) / costTotal) * 100 : 0,
                sector: p.sector || getSectorForSymbol(p.symbol),
              };
            });
          }
        }

        if (cancelled) return;
        setPositions(posList);

        // Load YTD trade summary
        const summary = await loadTradeSummary(connected);
        if (!cancelled) setTradeSummary(summary);

        // Load wash sale statuses for loss positions
        const lossSymbols = posList.filter(p => p.unrealizedPL < 0).map(p => p.symbol);
        if (lossSymbols.length > 0) {
          const statuses: Record<string, WashSaleStatus> = {};
          await Promise.all(lossSymbols.map(async (sym) => {
            try {
              const res = await fetch(`/api/strategies/tax-harvest/wash-sale-check?symbol=${sym}`);
              if (res.ok) statuses[sym] = await res.json();
              else statuses[sym] = { symbol: sym, isSafe: true, daysSinceLastTrade: Infinity, lastTradeDate: null };
            } catch {
              statuses[sym] = { symbol: sym, isSafe: true, daysSinceLastTrade: Infinity, lastTradeDate: null };
            }
          }));
          if (!cancelled) setWashSaleStatuses(statuses);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  // ─── Toast auto-dismiss ──────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Derived ─────────────────────────────────────────────
  const lossPositions = useMemo(() =>
    positions.filter(p => p.unrealizedPL < 0)
      .sort((a, b) => a.unrealizedPL - b.unrealizedPL),
    [positions],
  );

  const totalLossHarvestable = useMemo(() =>
    Object.values(selectedHarvests).reduce((s, h) => s + Math.abs(h.loss), 0),
    [selectedHarvests],
  );

  const totalTaxSavings = useMemo(() =>
    totalLossHarvestable * 0.20,
    [totalLossHarvestable],
  );

  const selectedCount = Object.keys(selectedHarvests).length;
  const replacementCount = Object.keys(selectedReplacements).length;

  // ─── Handlers ────────────────────────────────────────────
  const handleHarvest = useCallback((pos: Position) => {
    const washStatus = washSaleStatuses[pos.symbol];
    const isWashBlocked = washStatus && !washStatus.isSafe;

    setSelectedHarvests(prev => {
      if (prev[pos.symbol]) {
        const next = { ...prev };
        delete next[pos.symbol];
        return next;
      }
      const loss = Math.abs(pos.unrealizedPL);
      return {
        ...prev,
        [pos.symbol]: {
          symbol: pos.symbol,
          qty: pos.qty,
          costBasis: pos.costBasis,
          currentPrice: pos.currentPrice,
          loss,
          lossPct: Math.abs(pos.unrealizedPLPct),
          estTaxSavings: loss * 0.20,
        },
      };
    });
  }, [washSaleStatuses]);

  const handleSelectReplacement = useCallback((symbol: string, replacement: { symbol: string; name: string; price: number }) => {
    setSelectedReplacements(prev => {
      if (prev[symbol]?.symbol === replacement.symbol) {
        const next = { ...prev };
        delete next[symbol];
        return next;
      }
      return { ...prev, [symbol]: replacement };
    });
  }, []);

  const handleExecute = async () => {
    setSubmitting(true);
    try {
      const res = await await apiPost('/api/strategies/tax-harvest/execute', {
          harvests: Object.values(selectedHarvests),
          replacements: selectedReplacements,
          taxYear: currentYear,
        });
      if (res.ok) {
        setShowConfirm(false);
        setSelectedHarvests({});
        setSelectedReplacements({});
        setToast('✓ Harvest complete');
      } else {
        const err = await res.json();
        setToast(err.error || 'Execution failed');
      }
    } catch {
      setToast('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#0f172a', color: '#f1f5f9', padding: '16px 16px 300px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, animation: 'dcaToastIn 0.25s ease-out', background: '#22c55e', color: '#0f172a', padding: '8px 18px', borderRadius: 9999, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <span style={{ padding: '4px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 9999, fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
            {currentYear} Tax Year
          </span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '8px 0 6px' }}>Tax Loss Harvesting</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Offset gains and reduce your tax bill</p>
        {showUrgency && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, fontSize: 12, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} />
            <span>⚠️ Year-end deadline approaching. Losses must be realized by Dec 31.</span>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
          <div style={{ width: 24, height: 24, border: '3px solid #334155', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {loadError && (
        <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13, color: '#f87171', marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      {isDemo && !loading && (
        <div style={{ padding: '8px 14px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, fontSize: 11, fontWeight: 600, color: '#fbbf24', marginBottom: 16, textAlign: 'center' }}>
          ⚠️ Demo mode — connect broker to harvest real losses
        </div>
      )}

      {!loading && !loadError && (
        <>
          {/* ─── Section 1: YTD Summary ──────────────── */}
          <Section icon={<Activity size={12} />} label="YTD Summary">
            {tradeSummary.realizedGains === 0 && tradeSummary.realizedLosses === 0 ? (
              <div style={{ fontSize: 13, color: '#64748b', padding: '12px 0', textAlign: 'center' }}>
                No realized gains or losses yet this year
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <SummaryCard label="Realized Gains" value={tradeSummary.realizedGains} color="#4ade80" />
                  <SummaryCard label="Realized Losses" value={Math.abs(tradeSummary.realizedLosses)} color="#f87171" />
                  <SummaryCard label="Net Position" value={tradeSummary.netPosition} color={tradeSummary.netPosition >= 0 ? '#4ade80' : '#f87171'} />
                </div>
                {tradeSummary.realizedGains > 0 && (
                  <div style={{ fontSize: 12, color: '#64748b', padding: '8px 12px', background: '#1e293b', borderRadius: 8 }}>
                    Harvestable losses could save you approximately <strong style={{ color: '#4ade80' }}>${((tradeSummary.realizedGains - tradeSummary.realizedLosses) * 0.20).toFixed(2)}</strong> in taxes (est. 20% rate)
                  </div>
                )}
              </>
            )}
          </Section>

          {/* ─── Section 2: Loss Positions ───────────── */}
          <Section icon={<TrendingDown size={12} />} label="Loss Positions">
            {lossPositions.length === 0 ? (
              <div style={{ fontSize: 13, color: '#64748b', padding: '12px 0', textAlign: 'center' }}>
                No harvestable losses in your portfolio
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lossPositions.map(pos => {
                  const isSelected = !!selectedHarvests[pos.symbol];
                  const wash = washSaleStatuses[pos.symbol];
                  const isWashBlocked = wash && !wash.isSafe;
                  const replacement = selectedReplacements[pos.symbol];
                  const suggestions = getReplacementSuggestions(pos.sector);

                  return (
                    <div key={pos.symbol} style={{ padding: 12, background: '#1e293b', border: `1px solid ${isSelected ? '#06b6d4' : '#334155'}`, borderRadius: 10, transition: 'border-color 0.2s' }}>
                      {/* Position info */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14 }}>{pos.symbol}</span>
                          <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>{pos.name}</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#f87171' }}>
                          -${Math.abs(pos.unrealizedPL).toFixed(2)} ({pos.unrealizedPLPct.toFixed(1)}%)
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
                        <span>Cost: ${pos.costBasis.toFixed(2)}</span>
                        <span>Current: ${pos.marketValue.toFixed(2)}</span>
                        <span style={{ color: '#4ade80' }}>Savings: ${(Math.abs(pos.unrealizedPL) * 0.20).toFixed(2)}</span>
                      </div>

                      {/* Wash sale status */}
                      <div style={{ fontSize: 11, color: isWashBlocked ? '#fbbf24' : '#4ade80', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isWashBlocked ? (
                          <>
                            <AlertTriangle size={12} />
                            <span>⚠️ Wash sale risk — bought {wash.daysSinceLastTrade} days ago</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle size={12} />
                            <span>✅ Safe to harvest</span>
                          </>
                        )}
                      </div>

                      {/* Harvest button + replacement */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: isSelected ? 10 : 0 }}>
                        <button
                          onClick={() => handleHarvest(pos)}
                          disabled={isWashBlocked}
                          style={{
                            flex: 1, padding: '8px 12px',
                            background: isSelected ? '#334155' : isWashBlocked ? '#1e293b' : '#1e293b',
                            border: `1px solid ${isSelected ? '#06b6d4' : '#334155'}`,
                            borderRadius: 8, color: isSelected ? '#06b6d4' : isWashBlocked ? '#475569' : '#94a3b8',
                            fontSize: 12, fontWeight: 600, cursor: isWashBlocked ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          {isWashBlocked ? 'Blocked — Wash Sale' : isSelected ? 'Deselect' : 'Harvest Loss'}
                        </button>
                      </div>

                      {/* Replacement suggestions */}
                      {isSelected && (
                        <div style={{ padding: '10px 12px', background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                            To maintain market exposure, consider buying:
                          </div>
                          {suggestions.slice(0, 2).map((s, i) => {
                            const isReplacement = replacement?.symbol === s.symbol;
                            return (
                              <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: i > 0 ? '1px solid #1e293b' : 'none' }}>
                                <div>
                                  <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 12 }}>{s.symbol}</span>
                                  <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6 }}>{s.name}</span>
                                </div>
                                <button
                                  onClick={() => handleSelectReplacement(pos.symbol, { ...s, price: pos.currentPrice * 0.95 })}
                                  style={{
                                    padding: '4px 10px',
                                    background: isReplacement ? '#06b6d4' : 'none',
                                    border: `1px solid ${isReplacement ? '#06b6d4' : '#334155'}`,
                                    borderRadius: 6, color: isReplacement ? '#0f172a' : '#94a3b8',
                                    fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {isReplacement ? 'Selected' : 'Select'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ─── Section 3: Wash Sale Rule ───────────── */}
          <Section icon={<AlertTriangle size={12} />} label="Wash Sale Rule">
            <button
              onClick={() => setShowWashRule(!showWashRule)}
              style={{ width: '100%', padding: '10px 14px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, color: '#fbbf24', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={12} /> Wash Sale Rule
              </span>
              {showWashRule ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showWashRule && (
              <div style={{ padding: '12px 14px', marginTop: 8, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 8px' }}>
                  <strong style={{ color: '#fbbf24' }}>You cannot repurchase the same security</strong> within 30 days before or after selling it for a loss.
                  If you do, the IRS disallows the loss deduction.
                </p>
                <p style={{ margin: 0 }}>
                  Vantage automatically checks your last 30 days of trades. Position cards marked with <span style={{ color: '#f87171' }}>⚠️ Wash sale risk</span> have recent purchases.
                </p>
                {/* Show blocked positions */}
                {Object.entries(washSaleStatuses).filter(([, s]) => !s.isSafe).length > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(251,191,36,0.08)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: 4 }}>⚠️ Restricted positions:</div>
                    {Object.entries(washSaleStatuses).filter(([, s]) => !s.isSafe).map(([sym, status]) => (
                      <div key={sym} style={{ fontSize: 11, color: '#fbbf24' }}>
                        {sym} — bought {status.daysSinceLastTrade} days ago
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ─── Section 4: Harvest Summary ──────────── */}
          {selectedCount > 0 && (
            <Section icon={<Info size={12} />} label="Harvest Summary">
              <div style={{ padding: 14, background: '#1e293b', border: '1px solid #334155', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Selected Harvests
                </div>
                {Object.values(selectedHarvests).map(h => (
                  <div key={h.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{h.symbol}</span>
                    <span style={{ color: '#94a3b8' }}>Sell {h.qty} shares</span>
                    <span style={{ color: '#f87171' }}>-${h.loss.toFixed(2)}</span>
                    <span style={{ color: '#4ade80' }}>${h.estTaxSavings.toFixed(2)} saved</span>
                  </div>
                ))}

                {replacementCount > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 8px' }}>
                      Replacements
                    </div>
                    {Object.entries(selectedReplacements).map(([sym, r]) => (
                      <div key={sym} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
                        <span style={{ fontWeight: 600, color: '#06b6d4' }}>{r.symbol}</span>
                        <span style={{ color: '#94a3b8' }}>{r.name}</span>
                        <span style={{ color: '#64748b' }}>Buy ${(selectedHarvests[sym]?.loss || 0).toFixed(2)} worth</span>
                      </div>
                    ))}
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '1px solid #334155', marginTop: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>Total Est. Tax Savings</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#4ade80' }}>${totalTaxSavings.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#64748b' }}>Total Transactions</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>{selectedCount + replacementCount}</div>
                  </div>
                </div>
              </div>
            </Section>
          )}
        </>
      )}

      {/* ─── Bottom Bar ────────────────────────────── */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'linear-gradient(to top, #0f172a 80%, rgba(15,23,42,0.95))', padding: '12px 16px 84px', borderTop: '1px solid #1e293b' }}>
        {!isConnected && selectedCount > 0 && (
          <div style={{ fontSize: 10, color: '#fbbf24', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Demo mode — connect broker to execute live trades
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={selectedCount === 0 || submitting || !isConnected}
            style={{
              flex: 1, padding: 14, borderRadius: 10, border: 'none',
              background: selectedCount > 0 && !submitting && isConnected ? 'linear-gradient(135deg, #06b6d4, #0d9488)' : '#334155',
              color: selectedCount > 0 && !submitting && isConnected ? '#0f172a' : '#64748b',
              fontSize: 15, fontWeight: 700,
              cursor: selectedCount > 0 && !submitting && isConnected ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', transition: 'all 0.2s ease',
            }}
          >
            {submitting ? 'Executing...' : isConnected ? `Execute Harvest (${selectedCount})` : 'Connect Broker to Execute'}
          </button>
          <button onClick={() => router.back()} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Cancel
          </button>
        </div>
      </div>

      {/* ─── Confirm Modal ────────────────────────── */}
      {showConfirm && (
        <div onClick={() => setShowConfirm(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24 }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9', margin: '0 0 8px' }}>Confirm Harvest</h3>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
              This will sell <strong style={{ color: '#f1f5f9' }}>{selectedCount} positions</strong>
              {replacementCount > 0 && <> and buy <strong style={{ color: '#f1f5f9' }}>{replacementCount} replacements</strong></>}.
            </p>
            <div style={{ padding: 12, background: 'rgba(6,182,212,0.06)', borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#4ade80', marginBottom: 4 }}>
                Est. tax savings: ${totalTaxSavings.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={11} />
                Do not repurchase harvested stocks for 30 days.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: 12, background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleExecute} disabled={submitting} style={{ flex: 1, padding: 12, background: submitting ? '#334155' : 'linear-gradient(135deg, #06b6d4, #0d9488)', border: 'none', borderRadius: 8, color: submitting ? '#64748b' : '#0f172a', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                {submitting ? 'Executing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes dcaToastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: '10px 12px', background: '#1e293b', borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color }}>
        {value < 0 ? '-' : ''}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}

// ─── Helper: sector guess by symbol ─────────────────────────
function getSectorForSymbol(symbol: string): string {
  const map: Record<string, string> = {
    AAPL: 'technology', MSFT: 'technology', NVDA: 'technology', GOOGL: 'communication services',
    AMZN: 'consumer cyclical', META: 'communication services', TSLA: 'consumer cyclical',
    BRK_B: 'financial', JPM: 'financial', BAC: 'financial', WFC: 'financial',
    UNH: 'healthcare', JNJ: 'healthcare', PFE: 'healthcare', ABBV: 'healthcare',
    XOM: 'energy', CVX: 'energy', COP: 'energy',
    HD: 'consumer cyclical', KO: 'consumer defensive', PG: 'consumer defensive',
    CRM: 'technology', ADBE: 'technology', INTC: 'technology', AMD: 'technology',
    DIS: 'communication services', NFLX: 'communication services',
  };
  return map[symbol] || 'technology';
}

// ─── YTD trade summary loader ───────────────────────────────
async function loadTradeSummary(connected: boolean): Promise<TradeSummary> {
  // Try DB trade history first
  try {
    const res = await await apiGet('/api/db/trade-history/sync');
    if (res.ok) {
      const data = await res.json();
      const currentYear = getCurrentYear();
      const yearStart = `${currentYear}-01-01`;
      const trades = (data.trades || []).filter((t: any) => t.filled_at >= yearStart);
      let gains = 0;
      let losses = 0;
      for (const t of trades) {
        const pl = t.realized_pl || t.realizedPL || 0;
        if (pl > 0) gains += pl;
        else losses += Math.abs(pl);
      }
      return { realizedGains: gains, realizedLosses: losses, netPosition: gains - losses };
    }
  } catch { /* fallback */ }

  // Fallback: estimated demo values
  if (!connected) {
    return { realizedGains: 2500, realizedLosses: 800, netPosition: 1700 };
  }

  return { realizedGains: 0, realizedLosses: 0, netPosition: 0 };
}
