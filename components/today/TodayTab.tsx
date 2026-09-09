// ─── Today Tab — the app's home screen ─────────────────────
// Replaces the old Portfolio tab as the landing screen.
//
// Top-to-bottom:
//   1. Masthead — "Rufus" serif-italic wordmark + market status + account
//      name, single line, one 2px #5FD8DE rule beneath.
//   2. Lead story — full-bleed AI Noticed card (category label, serif-italic
//      key stat, supporting sentence, real-holdings donut + 2-line legend,
//      CTA action row + "Remind in Nd" snooze). Fallback = Daily Brief
//      top-line headline only (tap opens full brief).
//   3. Secondary notices strip — compact cards (category + one line, no CTA).
//   4. Balance section — #050A14 bg, serif-italic balance, Today/Total inline,
//      ~46px SVG trend glyph, top holdings total-gain, "See all holdings".
//
// Data is real: positions come from the same canonical sources as the
// concentration-risk card (no hardcoded values). Colors use the finalized
// tokens only.

'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import { useAccounts } from '@/context/AccountContext';
import { useTabStore } from '@/store';
import type { Position, AccountSummary } from '@/types';
import { apiGet, apiPost } from '@/lib/api-client';
import { getMarketStatus } from '@/lib/market-hours';

// ─── Finalized tokens ──────────────────────────────────────
const C = {
  canvas: '#000814',
  card: '#0A0F1E',
  cardBorder: '#141C2E',
  rule: '#2A3648',
  textPrimary: '#EAEEF7',
  textSecondary: '#C4CCDC',
  textMuted: '#8891A6',
  textFaint: '#5C6478',
  gain: '#3DDC84',
  loss: '#F0716B',
  amber: '#D9A94A',
  accent: '#5FD8DE',
  accentText: '#00272B',
  balanceBg: '#050A14',
};

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const fmt = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;

const pctStr = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

function splitCents(value: number): { dollars: string; cents: string } {
  const str = value.toLocaleString('en-US', DOLLAR_FMT);
  const parts = str.split('.');
  return { dollars: parts[0] || '0', cents: parts[1] || '00' };
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// Humanize trigger_type → category label.
function humanizeTrigger(triggerType: string): string {
  switch (triggerType) {
    case 'concentration_single':
    case 'concentration_top3':
      return 'CONCENTRATION';
    case 'idle_cash':
      return 'IDLE CASH';
    case 'position_milestone':
      return 'MILESTONE';
    case 'portfolio_drift':
      return 'DRIFT';
    case 'event_impact':
      return 'EVENT';
    case 'wash_sale':
      return 'WASH SALE';
    case 'bounce_back':
      return 'BOUNCE BACK';
    case 'earnings_proximity':
      return 'EARNINGS';
    case 'sentiment_shift':
      return 'SENTIMENT';
    default:
      return 'RUFUS NOTICED';
  }
}

function semanticColor(variant: string): string {
  if (variant === 'warn') return C.amber;
  if (variant === 'gain') return C.gain;
  return C.accent;
}

function shortenMarketLabel(label: string): string {
  if (label === 'MARKET HOLIDAY') return 'HOLIDAY';
  if (label === 'PRE-MARKET') return 'PRE-MKT';
  if (label === 'AFTER HOURS') return 'AFTER HRS';
  return label;
}

// ─── Real-holdings donut (finalized tokens) ────────────────
function TodayDonut({ positions }: { positions: Position[] }) {
  const data = useMemo(() => {
    const total = positions.reduce((s, p) => s + (p.marketValue || 0), 0);
    if (total <= 0) return [];
    return positions
      .filter((p) => (p.marketValue || 0) > 0)
      .map((p) => ({ symbol: p.symbol, value: p.marketValue, pct: (p.marketValue / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }, [positions]);

  if (data.length === 0) return null;

  const R = 30;
  const CIRC = 2 * Math.PI * R;
  const STROKE = 11;
  const SEG_COLORS = [C.amber, C.accent, 'rgba(255,255,255,0.35)'];
  let cumulative = 0;
  const segments = data.map((d, i) => {
    const len = (d.pct / 100) * CIRC;
    const color = SEG_COLORS[i] ?? 'rgba(255,255,255,0.10)';
    const seg = (
      <circle
        key={d.symbol}
        cx="40"
        cy="40"
        r={R}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeDasharray={`${len} ${CIRC - len}`}
        strokeDashoffset={-cumulative}
        transform="rotate(-90 40 40)"
      />
    );
    cumulative += len;
    return seg;
  });

  // Legend shows the same top-3 the concentration headline names ("Top 3 are X% of you").
  const LEGEND_COLORS = [C.amber, C.accent, 'rgba(255,255,255,0.35)'];
  const topThree = data.slice(0, 3);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" style={{ flexShrink: 0 }}>
        {segments}
      </svg>
      {/* legend (top-3 to match headline) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {topThree.map((d, i) => (
          <div key={d.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textSecondary }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: LEGEND_COLORS[i], flexShrink: 0 }} />
            <span style={{ fontWeight: 700, color: C.textPrimary, whiteSpace: 'nowrap' }}>{d.symbol}</span>
            <span style={{ color: C.textFaint }}>{d.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ~46px trend glyph (honest direction indicator) ───────
function TrendGlyph({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" style={{ flexShrink: 0 }}>
      {up ? (
        <path
          d="M9 32 L23 15 L37 32"
          fill="none"
          stroke={C.gain}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M9 15 L23 32 L37 15"
          fill="none"
          stroke={C.loss}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

// ─── Daily brief top-line fallback ─────────────────────────
interface ParsedLine {
  label: string;
  text: string;
}

function parseBrief(content: string): ParsedLine[] {
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const match = line.match(/^(MARKET|PORTFOLIO|WATCH|EARNINGS):\s*(.+)/i);
      if (match) return { label: match[1].toUpperCase(), text: match[2].trim() };
      return { label: '', text: line.trim() };
    })
    .filter((l) => l.text);
}

export function TodayTab() {
  const { account: brokerAccount, loading: brokerLoading } = usePortfolio();
  const { account: liveAccount, loading: liveLoading, brokerMeta } = useLivePortfolio();
  const { isConnected } = useBroker();
  const { activeAccount, activeAccountId } = useAccounts();
  const { setTab, setChatOpen, setPendingPrompt, setFocusPosition } = useTabStore();

  const isShowingDemo = activeAccount?.isDemo ?? false;
  const isReadOnly = !isShowingDemo && !(activeAccount?.tradingEnabled ?? false);
  const isBrokerExpected = isConnected && !isShowingDemo;

  const displayAccount = isBrokerExpected
    ? (brokerAccount as AccountSummary | null)
    : (liveAccount as AccountSummary | null);
  const loading = isBrokerExpected ? brokerLoading : liveLoading;

  const positions: Position[] = displayAccount?.positions || [];

  // ── Market status ──
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());
  useEffect(() => {
    const t = setInterval(() => setMarketStatus(getMarketStatus()), 60000);
    return () => clearInterval(t);
  }, []);

  // ── Account name for the masthead ──
  const accountName = isShowingDemo ? 'Demo' : brokerMeta?.name || activeAccount?.name || 'Broker';

  // ── AI Noticed feed ──
  const [noticedItems, setNoticedItems] = useState<any[]>([]);
  const fetchNoticed = useCallback(async () => {
    try {
      const res = await apiGet(`/api/ai/noticed?accountId=${encodeURIComponent(activeAccountId || 'demo')}`);
      if (res.ok) {
        const data = await res.json();
        setNoticedItems(data.items || []);
      }
    } catch { /* ignore */ }
  }, [activeAccountId]);
  useEffect(() => { fetchNoticed(); }, [fetchNoticed]);

  const leadItem = noticedItems.find((i) => i.action) || noticedItems[0] || null;
  const secondaryItems = noticedItems.filter((i) => i !== leadItem).slice(0, 3);

  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const handleDismiss = async (itemId: string, dismissType: string) => {
    setSnoozeOpen(false);
    setNoticedItems((prev) => prev.filter((i) => i.id !== itemId));
    try { await apiPost('/api/ai/noticed/dismiss', { itemId, dismissType }); } catch { /* ignore */ }
  };

  // ── Daily brief fallback ──
  const [briefLines, setBriefLines] = useState<ParsedLine[]>([]);
  const [briefOpen, setBriefOpen] = useState(false);
  useEffect(() => {
    if (leadItem) return; // only needed when there's no lead story
    let cancelled = false;
    (async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
        const r = await apiGet(`/api/ai/daily-brief?tz=${encodeURIComponent(tz)}&accountId=${encodeURIComponent(activeAccountId || 'demo')}`);
        if (r.ok && !cancelled) {
          const d = await r.json();
          setBriefLines(parseBrief(d.content || ''));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [leadItem, activeAccountId]);

  // ── Derived account numbers (single source of truth) ─────
  const investedValue = positions.reduce((acc, p) => acc + (p.marketValue || p.qty * (p.currentPrice || p.avgCost)), 0);
  const demoTotalCost = positions.reduce((acc, p) => acc + p.qty * p.avgCost, 0);
  const demoCashBalance = Math.max(0, 100000 - demoTotalCost);
  const demoEquity = investedValue + demoCashBalance;
  const demoTodayPnL = positions.reduce((acc, p) => acc + (p.dayChange || 0), 0);

  const accountData: AccountSummary = displayAccount || (isBrokerExpected ? {
    equity: 0, cash: 0, buyingPower: null, dayPnl: 0, dayPnlPercent: 0,
    totalPnl: 0, totalPnlPercent: 0, positions: [],
  } : isShowingDemo ? {
    equity: demoEquity, cash: demoCashBalance, buyingPower: demoCashBalance,
    dayPnl: demoTodayPnL, dayPnlPercent: demoEquity > 0 ? (demoTodayPnL / demoEquity) * 100 : 0,
    totalPnl: demoEquity - 100000, totalPnlPercent: ((demoEquity - 100000) / 100000) * 100,
    positions,
  } : {
    equity: 0, cash: 0, buyingPower: null, dayPnl: 0, dayPnlPercent: 0,
    totalPnl: 0, totalPnlPercent: 0, positions: [],
  });

  const { dollars, cents } = splitCents(accountData.equity);

  // Top holdings (by market value) for the balance section — total P&L only.
  const topHoldings = useMemo(
    () =>
      [...positions]
        .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
        .slice(0, 4),
    [positions],
  );

  // ── Lead-story CTA (reuses ActionButton semantics, new tokens) ──
  const renderCta = () => {
    if (!leadItem) return null;
    const a: string = leadItem.action;
    let primaryLabel = '';
    let secondaryLabel = '';
    let onPrimary: (() => void) | undefined;
    let onSecondary: (() => void) | undefined;

    if (a === 'REBALANCE') {
      onPrimary = () => { setPendingPrompt('rebalance'); setChatOpen(true); };
      if (isReadOnly) {
        primaryLabel = 'Download';
      } else {
        primaryLabel = 'Trade';
        secondaryLabel = 'Download';
        onSecondary = onPrimary;
      }
    } else if (a.startsWith('REVIEW_POSITION:')) {
      const ticker = a.slice('REVIEW_POSITION:'.length).trim();
      if (ticker) {
        primaryLabel = `Review ${ticker}`;
        onPrimary = () => { setFocusPosition(ticker); setTab('portfolio'); };
      }
    } else if (a.startsWith('INVEST_CASH:')) {
      const amount = Number(a.slice('INVEST_CASH:'.length).trim());
      if (Number.isFinite(amount) && amount > 0) {
        primaryLabel = `Invest $${amount.toLocaleString()}`;
        onPrimary = () => {
          setPendingPrompt(`Build me a portfolio with my $${amount.toLocaleString()} of idle cash.`);
          setChatOpen(true);
        };
      }
    }

    if (!primaryLabel || !onPrimary) return null;

    const showDonut =
      a === 'REBALANCE' ||
      leadItem.triggerType === 'concentration_single' ||
      leadItem.triggerType === 'concentration_top3';

    return (
      <>
        {showDonut && <TodayDonut positions={positions} />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPrimary?.(); }}
            style={{
              background: C.accent, color: C.accentText, border: 'none', borderRadius: 10,
              padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSecondary?.(); }}
              style={{
                background: 'transparent', border: 'none', color: C.accent,
                padding: '10px 6px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3,
              }}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSnoozeOpen((o) => !o); }}
            style={{
              background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)',
              padding: '10px 6px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', marginLeft: 'auto',
            }}
          >
            Remind in 5d
          </button>
        </div>
      </>
    );
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* ── 1. Masthead ── */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 19, color: C.textPrimary, lineHeight: 1 }}>
            Rufus
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: C.gain }}>
              ● {shortenMarketLabel(marketStatus.label)}
            </span>
            <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{accountName}</span>
          </div>
        </div>
        <div style={{ height: 2, background: C.accent, marginTop: 14, borderRadius: 1 }} />
      </div>

      {/* ── 2. Lead story (full-bleed) ── */}
      {leadItem ? (
        <div style={{ padding: '22px 20px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: semanticColor(leadItem.variant) }}>
            {humanizeTrigger(leadItem.triggerType)}
          </span>
          <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 40, lineHeight: 1.08, color: C.textPrimary, marginTop: 8 }}>
            {leadItem.title}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: C.textSecondary, marginTop: 10, maxWidth: 520 }}>
            {leadItem.body}
          </div>
          {renderCta()}
          {snoozeOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setSnoozeOpen(false)} />
              <div style={{
                position: 'absolute', right: '20px', marginTop: 8, zIndex: 9999,
                background: '#0A0F1E', border: `1px solid ${C.rule}`, borderRadius: 10,
                padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
                minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                {[
                  { label: 'Remind in 3 days', type: '3d' },
                  { label: 'Remind in 5 days', type: '5d' },
                  { label: 'Remind in 1 week', type: '1w' },
                  { label: 'Remind in 2 weeks', type: '14d' },
                  { label: "Don't remind again", type: 'permanent' },
                ].map((opt) => (
                  <button
                    key={opt.type}
                    onClick={(e) => { e.stopPropagation(); handleDismiss(leadItem.id, opt.type); }}
                    style={{
                      background: 'transparent', border: 'none', color: C.textSecondary,
                      fontSize: 12, padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                      textAlign: 'left', fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {leadItem.createdAt && (
            <div style={{ fontSize: 10, color: C.textFaint, marginTop: 12, opacity: 0.7 }}>
              {formatRelativeTime(leadItem.createdAt)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '22px 20px 0' }}>
          {briefLines.length > 0 ? (
            <button
              type="button"
              onClick={() => setBriefOpen((o) => !o)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted }}>
                {briefLines[0].label || 'DAILY BRIEF'}
              </span>
              <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 28, lineHeight: 1.15, color: C.textPrimary, marginTop: 8 }}>
                {briefLines[0].text}
              </div>
            </button>
          ) : (
            <div style={{ fontSize: 14, color: C.textFaint }}>No insights yet today.</div>
          )}
          {briefOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {briefLines.map((l, i) => (
                <div key={i} style={{ fontSize: 14, lineHeight: 1.55 }}>
                  {l.label && (
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.03em', color: C.textMuted, marginRight: 6 }}>
                      {l.label}
                    </span>
                  )}
                  <span style={{ color: C.textSecondary }}>{l.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 3. Secondary notices strip ── */}
      {secondaryItems.length > 0 && (
        <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {secondaryItems.map((item) => (
            <div
              key={item.id}
              style={{
                background: C.card, border: `0.5px solid ${C.cardBorder}`, borderRadius: 14,
                padding: '12px 14px', display: 'flex', alignItems: 'baseline', gap: 10,
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: semanticColor(item.variant), flexShrink: 0 }}>
                {humanizeTrigger(item.triggerType)}
              </span>
              <span style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.4, minWidth: 0 }}>
                {item.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── 4. Balance section ── */}
      <div style={{ margin: '20px 20px 0', background: C.balanceBg, border: `0.5px solid ${C.cardBorder}`, borderRadius: 16, padding: '18px 18px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.textFaint }}>
          PORTFOLIO VALUE
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div>
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 26, color: C.textPrimary }}>
                ${dollars}
              </span>
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18, color: C.textMuted }}>
                .{cents}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>
                Today{' '}
                <span style={{ color: accountData.dayPnl >= 0 ? C.gain : C.loss, fontWeight: 600 }}>
                  {fmt(accountData.dayPnl)} ({pctStr(accountData.dayPnlPercent)})
                </span>
              </span>
              <span style={{ color: C.textFaint, fontSize: 12 }}>·</span>
              <span style={{ fontSize: 12, color: C.textMuted }}>
                Total{' '}
                <span style={{ color: accountData.totalPnl >= 0 ? C.gain : C.loss, fontWeight: 600 }}>
                  {fmt(accountData.totalPnl)} ({pctStr(accountData.totalPnlPercent)})
                </span>
              </span>
            </div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <TrendGlyph value={accountData.dayPnl} />
          </div>
        </div>

        {/* Top holdings — total P&L only */}
        {topHoldings.length > 0 && (
          <div style={{ marginTop: 16, borderTop: `0.5px solid ${C.cardBorder}`, paddingTop: 12 }}>
            {topHoldings.map((p) => {
              const pnl = p.totalPnl ?? (p.currentPrice - p.avgCost) * p.qty;
              return (
                <div key={p.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>{p.symbol}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: pnl >= 0 ? C.gain : C.loss }}>
                    {pnl >= 0 ? '+' : ''}{fmt(pnl)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setTab('portfolio')}
          style={{
            display: 'inline-block', marginTop: 14, background: 'none', border: 'none',
            color: C.accent, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        >
          See all holdings →
        </button>
      </div>
    </div>
  );
}

export default TodayTab;
