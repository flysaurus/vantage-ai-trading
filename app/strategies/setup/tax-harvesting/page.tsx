'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingDown, AlertTriangle, ArrowRightLeft, Activity } from 'lucide-react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';

// ─── Tax-loss harvesting partner ETFs ──────────────────────
// Keys = commonly held ETFs, value = near-identical replacement
// that tracks the same index/segment without triggering wash sale
const PARTNERS: Record<string, { symbol: string; name: string; note: string }> = {
  SPY:  { symbol: 'VOO',  name: 'Vanguard S&P 500 ETF',       note: 'Tracks same S&P 500 index — near identical' },
  VOO:  { symbol: 'IVV',  name: 'iShares Core S&P 500 ETF',   note: 'Tracks same S&P 500 index — near identical' },
  IVV:  { symbol: 'SPY',  name: 'SPDR S&P 500 ETF Trust',     note: 'Tracks same S&P 500 index — near identical' },
  VTI:  { symbol: 'ITOT', name: 'iShares Core S&P Total US',  note: 'Both track total US market' },
  ITOT: { symbol: 'SCHB', name: 'Schwab US Broad Market ETF', note: 'Both track total US market' },
  SCHB: { symbol: 'VTI',  name: 'Vanguard Total Stock Market',note: 'Both track total US market' },
  QQQ:  { symbol: 'QQQM', name: 'Invesco NASDAQ 100 ETF',     note: 'Same index, lower expense ratio' },
  QQQM: { symbol: 'QQQ',  name: 'Invesco QQQ Trust',          note: 'Same index, higher liquidity' },
  IWM:  { symbol: 'VB',   name: 'Vanguard Small-Cap ETF',     note: 'Both track US small-caps' },
  VB:   { symbol: 'IWM',  name: 'iShares Russell 2000 ETF',   note: 'Both track US small-caps' },
  EFA:  { symbol: 'IEFA', name: 'iShares Core MSCI EAFE',     note: 'Both track developed ex-US markets' },
  IEFA: { symbol: 'EFA',  name: 'iShares MSCI EAFE ETF',      note: 'Both track developed ex-US markets' },
  VXUS: { symbol: 'IXUS', name: 'iShares Core MSCI Total Intl',note: 'Both track total international' },
  IXUS: { symbol: 'VXUS', name: 'Vanguard Total International',note: 'Both track total international' },
  TLT:  { symbol: 'IEF',  name: 'iShares 7-10 Year Treasury', note: 'Slightly shorter duration — still treasury' },
  IEF:  { symbol: 'TLT',  name: 'iShares 20+ Year Treasury',  note: 'Slightly longer duration — still treasury' },
  AGG:  { symbol: 'BND',  name: 'Vanguard Total Bond Market', note: 'Both track broad US investment-grade bonds' },
  BND:  { symbol: 'AGG',  name: 'iShares Core US Aggregate',  note: 'Both track broad US investment-grade bonds' },
  XLF:  { symbol: 'VFH',  name: 'Vanguard Financials ETF',    note: 'Both track US financial sector' },
  VFH:  { symbol: 'XLF',  name: 'Financial Select Sector SPDR',note: 'Both track US financial sector' },
  XLK:  { symbol: 'VGT',  name: 'Vanguard Information Tech',  note: 'Both track US tech sector' },
  VGT:  { symbol: 'XLK',  name: 'Technology Select Sector SPDR',note: 'Both track US tech sector' },
  GLD:  { symbol: 'IAU',  name: 'iShares Gold Trust',         note: 'Both track physical gold' },
  IAU:  { symbol: 'GLD',  name: 'SPDR Gold Trust',            note: 'Both track physical gold' },
};

interface HarvestOpportunity {
  symbol: string;
  name?: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  totalLoss: number;
  lossPercent: number;
  marketValue: number;
  partner?: { symbol: string; name: string; note: string };
  selected: boolean;
  washSaleWarning?: string;
}

// ─── Component ──────────────────────────────────────────────

export default function TaxHarvestingPage() {
  const router = useRouter();
  const { account, loading: portfolioLoading } = usePortfolio();
  const { isConnected } = useBroker();

  const positions = account?.positions ?? [];
  const totalValue = account?.equity ?? 0;

  const [harvestable, setHarvestable] = useState<HarvestOpportunity[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Calculate harvest opportunities
  useEffect(() => {
    if (positions.length === 0) { setHarvestable([]); return; }

    const opportunities: HarvestOpportunity[] = positions
      .filter(p => {
        // Only positions with unrealized losses
        const unrealized = (p.currentPrice - p.avgCost) * p.qty;
        return unrealized < 0;
      })
      .map(p => {
        const unrealized = (p.currentPrice - p.avgCost) * p.qty;
        const lossPercent = ((p.avgCost - p.currentPrice) / p.avgCost) * 100;
        const partner = PARTNERS[p.symbol];
        return {
          symbol: p.symbol,
          name: p.name,
          shares: p.qty,
          avgCost: p.avgCost,
          currentPrice: p.currentPrice,
          totalLoss: Math.abs(unrealized),
          lossPercent,
          marketValue: p.marketValue,
          partner,
          selected: false,
        };
      })
      .sort((a, b) => b.totalLoss - a.totalLoss); // biggest losses first

    setHarvestable(opportunities);
  }, [positions]);

  const selectedCount = harvestable.filter(h => h.selected).length;
  const totalLossHarvest = harvestable.filter(h => h.selected).reduce((s, h) => s + h.totalLoss, 0);
  const totalProceeds = harvestable.filter(h => h.selected).reduce((s, h) => s + h.marketValue, 0);

  const toggleSelect = (symbol: string) => {
    setHarvestable(prev => prev.map(h => h.symbol === symbol ? { ...h, selected: !h.selected } : h));
  };

  const selectAll = () => {
    setHarvestable(prev => prev.map(h => ({ ...h, selected: true })));
  };

  const deselectAll = () => {
    setHarvestable(prev => prev.map(h => ({ ...h, selected: false })));
  };

  const handleSubmit = () => {
    setConfirmOpen(true);
  };

  const executeHarvest = async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const selected = harvestable.filter(h => h.selected);
      const trades = selected.map(h => ({
        sellSymbol: h.symbol,
        sellShares: h.shares,
        sellValue: h.marketValue,
        buySymbol: h.partner?.symbol || null,
        buyName: h.partner?.name || null,
        estimatedValue: h.marketValue,
        lossRealized: h.totalLoss,
      }));

      const res = await fetch('/api/strategies/tax-harvesting/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades }),
      });

      if (!res.ok) {
        const err = await res.json();
        setToast(err.error || 'Harvest failed');
        return;
      }

      setToast('✓ Tax-loss harvesting orders placed');
      setTimeout(() => router.back(), 1500);
    } catch {
      setToast('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#0f172a', color: '#f1f5f9', padding: '16px 16px 180px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, animation: 'txToastIn 0.25s ease-out' }}>
          <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#f1f5f9', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 18px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmOpen && (
        <div onClick={() => setConfirmOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 24, maxWidth: 360, width: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 12 }}>Confirm Tax-Loss Harvesting</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
              This will sell <strong style={{ color: '#f1f5f9' }}>{selectedCount} position{selectedCount !== 1 ? 's' : ''}</strong> realizing <strong style={{ color: '#4ade80' }}>${totalLossHarvest.toFixed(2)}</strong> in losses.
            </div>
            {harvestable.filter(h => h.selected && h.partner).length > 0 && (
              <div style={{ fontSize: 12, color: '#06b6d4', marginBottom: 12 }}>
                {harvestable.filter(h => h.selected && h.partner).length} position(s) will be replaced with partner ETFs.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #475569', background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={executeHarvest} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #06b6d4, #0d9488)', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Harvest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button onClick={() => router.push('/strategies')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#06b6d4', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            View strategies →
          </button>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Tax-Loss Harvesting</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Realize losses to offset capital gains</p>
      </div>

      {/* ─── Section 1: Portfolio Overview ───────────── */}
      <Section icon={<Activity size={12} />} label="Portfolio Overview">
        {portfolioLoading && !account ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>
            <div style={{ width: 16, height: 16, border: '2px solid #334155', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spinTX 0.6s linear infinite' }} />
            Loading portfolio data...
          </div>
        ) : totalValue <= 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0', lineHeight: 1.6 }}>
            {!isConnected
              ? <>No positions found. Connect your broker to see live holdings,<br />or use demo data to explore tax-loss harvesting.</>
              : 'No positions found in your connected account.'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', marginBottom: 12 }}>
              Portfolio: ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.8fr 0.9fr', gap: 4, fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 8px', borderBottom: '1px solid #1e293b' }}>
              <span>Symbol</span>
              <span style={{ textAlign: 'right' }}>Value</span>
              <span style={{ textAlign: 'right' }}>Unrealized</span>
              <span style={{ textAlign: 'right' }}>Status</span>
            </div>
            {positions.map(pos => {
              const unrealized = (pos.currentPrice - pos.avgCost) * pos.qty;
              const isLoss = unrealized < 0;
              return (
                <div key={pos.symbol} style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.8fr 0.9fr', gap: 4, alignItems: 'center', padding: '8px', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{pos.symbol}</span>
                  <span style={{ textAlign: 'right', color: '#cbd5e1' }}>${pos.marketValue.toLocaleString()}</span>
                  <span style={{ textAlign: 'right', color: isLoss ? '#f87171' : '#4ade80', fontWeight: 600 }}>
                    {isLoss ? '-' : '+'}${Math.abs(unrealized).toFixed(2)}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: isLoss ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: isLoss ? '#f87171' : '#4ade80', justifySelf: 'end' }}>
                    {isLoss ? 'LOSS' : 'GAIN'}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </Section>

      {/* ─── Section 2: Harvest Opportunities ────────── */}
      <Section icon={<TrendingDown size={12} />} label="Harvest Opportunities">
        {harvestable.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
            {positions.length === 0
              ? 'No positions with unrealized losses found.'
              : 'All positions are in the green — no harvesting opportunities right now.'}
          </div>
        ) : (
          <>
            {/* Select all / deselect */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={selectAll} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                Select All
              </button>
              <button onClick={deselectAll} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
                Deselect All
              </button>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
                {selectedCount > 0 && `$${totalLossHarvest.toFixed(2)} in losses`}
              </div>
            </div>

            {harvestable.map(h => (
              <div
                key={h.symbol}
                onClick={() => toggleSelect(h.symbol)}
                style={{
                  padding: '12px 14px',
                  marginBottom: 8,
                  background: h.selected ? 'rgba(6,182,212,0.08)' : '#1e293b',
                  border: `1px solid ${h.selected ? '#06b6d4' : '#334155'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                {/* Position row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${h.selected ? '#06b6d4' : '#475569'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: h.selected ? '#06b6d4' : 'transparent', background: h.selected ? 'rgba(6,182,212,0.2)' : 'none' }}>
                      {h.selected ? '✓' : ''}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{h.symbol}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>
                    -${h.totalLoss.toFixed(2)}
                  </span>
                </div>

                {/* Details row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: h.partner ? 8 : 0 }}>
                  <span>{h.shares} shares · Avg ${h.avgCost.toFixed(2)} → Now ${h.currentPrice.toFixed(2)}</span>
                  <span style={{ color: '#f87171' }}>-{h.lossPercent.toFixed(1)}%</span>
                </div>

                {/* Partner ETF suggestion */}
                {h.partner && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#0f172a', borderRadius: 6, fontSize: 11 }}>
                    <ArrowRightLeft size={12} style={{ color: '#06b6d4', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ color: '#cbd5e1' }}>
                        Replace with <strong style={{ color: '#f1f5f9' }}>{h.partner.symbol}</strong> — {h.partner.name}
                      </span>
                      <div style={{ color: '#64748b', marginTop: 2 }}>{h.partner.note}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#4ade80', background: 'rgba(34,197,94,0.1)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                      Safe swap
                    </span>
                  </div>
                )}

                {h.washSaleWarning && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 6, fontSize: 10, color: '#fbbf24', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <AlertTriangle size={12} style={{ marginTop: 1 }} />
                    {h.washSaleWarning}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </Section>

      {/* ─── Section 3: Wash Sale Warning ────────────── */}
      <Section icon={<AlertTriangle size={12} />} label="Wash Sale Rules">
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: '#fbbf24' }}>⚠️ IRS Wash Sale Rule:</strong> If you sell a security at a loss and buy the same or
            "substantially identical" security within 30 days (before or after), the loss is disallowed for tax purposes.
          </p>
          <p style={{ margin: 0, color: '#64748b' }}>
            The partner ETF suggestions above are carefully selected to track similar
            market segments without being "substantially identical" — but always consult
            your tax advisor.
          </p>
        </div>
      </Section>

      {/* ─── Bottom Bar ────────────────────────────── */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'linear-gradient(to top, #0f172a 80%, rgba(15,23,42,0.95))', padding: '12px 16px 64px', borderTop: '1px solid #1e293b' }}>
        {!isConnected && (
          <div style={{ fontSize: 10, color: '#fbbf24', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Demo mode — connect broker to execute live trades
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleSubmit}
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
            {submitting ? 'Executing...'
              : !isConnected ? 'Connect Broker to Execute'
              : selectedCount === 0 ? 'Select Positions to Harvest'
              : `Harvest ${selectedCount} Position${selectedCount !== 1 ? 's' : ''}`}
          </button>
          <button onClick={() => router.back()} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Cancel
          </button>
        </div>
      </div>

      <style>{`@keyframes txToastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } } @keyframes spinTX { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Section Helper ─────────────────────────────────────────
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
