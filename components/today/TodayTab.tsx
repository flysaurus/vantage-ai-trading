// ─── Today Tab — the app's home screen ─────────────────────
// Replaces the old Portfolio tab as the landing screen.
//
// Top-to-bottom:
//   1. Header — canonical one-row pattern: connection dot + account name +
//      "VIEW ONLY" tag (left), investor-style text link (right), 0.5px
//      #141C2E bottom border.
//   2. Lead story — full-bleed AI Noticed card (category label, numeric key
//      stat at serif-italic hero size, ONE small supporting sentence,
//      real-holdings donut + 3-line legend, CTA row + "Remind in Nd" snooze).
//      Fallback = Daily Brief top-line headline only (tap opens full brief).
//   3. Secondary notices strip — horizontal-scroll compact cards
//      (category + one line, no CTA). Event-impact & other non-lead triggers
//      live here, never as a standalone block.
//   4. Portfolio section — "YOUR PORTFOLIO" label (thin rule above),
//      32px serif-italic balance, Today/Total inline, full-width 68px trend
//      chart, top holdings "+X% · +$Y", "See all holdings".
//
// Data is real: positions come from the same canonical sources as the
// concentration-risk card (no hardcoded values). Colors use the finalized
// tokens only.

'use client';

import React, { useState, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import { useAccounts } from '@/context/AccountContext';
import { useAuth } from '@/components/providers/AuthProvider';
import { getStyleContent } from '@/lib/content/investor-styles';
import { useTabStore } from '@/store';
import type { Position, AccountSummary } from '@/types';
import { apiGet, apiPost } from '@/lib/api-client';

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

// ─── Explainability chip text (data-derived, factual, muted) ─
// Small caption beneath the lead story's supporting sentence. Pulls real
// numbers from the trigger meta — never hardcoded generic copy.
function explainabilityText(item: any, positions: Position[]): string {
  const m = item.meta || {};
  const total = positions.length;
  switch (item.triggerType) {
    case 'concentration_top3': {
      const syms = Array.isArray(m.symbols) ? m.symbols : [];
      return syms.length > 0 && total > 0
        ? `${syms.length} of ${total} positions concentrated`
        : 'Based on your current holdings';
    }
    case 'concentration_single':
      return m.symbol && total > 0
        ? `${m.symbol} is ${total === 1 ? 'your only holding' : 'your largest holding'}`
        : 'Based on your current holdings';
    case 'idle_cash':
      return 'Based on your current cash balance';
    case 'portfolio_drift':
      return m.sector ? `${m.sector} vs your target allocation` : 'Based on your target allocation';
    case 'position_milestone':
      return m.symbol ? `Based on ${m.symbol} performance` : 'Based on position performance';
    case 'sentiment_shift':
      return 'Based on recent news coverage';
    case 'earnings_proximity':
      return m.symbol ? `Based on ${m.symbol} upcoming earnings` : 'Based on upcoming earnings';
    case 'wash_sale':
      return 'Based on your recent trading activity';
    case 'bounce_back':
      return 'Based on recent price movement';
    case 'event_impact':
      return 'Based on upcoming events';
    default:
      return 'Based on your current holdings';
  }
}

// ─── Lead-story numeric hero stat ──────────────────────────
// Extracts the single numeric value that belongs at hero size, per trigger
// type. Returns '' when a trigger has no clean number (then the title is
// used as the hero headline instead).
function leadStat(item: any): string {
  const m = item.meta || {};
  const num = (v: any) => (v == null ? NaN : Number(v));
  switch (item.triggerType) {
    case 'concentration_single':
    case 'concentration_top3': {
      const p = num(m.pct);
      return Number.isFinite(p) ? `${Math.round(p * 10) / 10}%` : '';
    }
    case 'portfolio_drift': {
      const d = num(m.deviation);
      return Number.isFinite(d) ? `${d > 0 ? '+' : ''}${Math.round(d)}%` : '';
    }
    case 'idle_cash': {
      const a = num(m.amount);
      return Number.isFinite(a) ? `$${a.toLocaleString('en-US')}` : '';
    }
    case 'position_milestone': {
      const p = num(m.currentPnlPct);
      return Number.isFinite(p) ? `${p >= 0 ? '+' : ''}${Math.round(p)}%` : '';
    }
    case 'bounce_back': {
      const d = num(m.discountPct);
      return Number.isFinite(d) ? `-${Math.abs(Math.round(d))}%` : '';
    }
    case 'sentiment_shift': {
      const n = num(m.negativeCount);
      const t = num(m.totalHeadlines);
      return Number.isFinite(n) && Number.isFinite(t) && t > 0 ? `${n}/${t}` : '';
    }
    default:
      return '';
  }
}

// ─── Lead-story priority (primary selection order) ─────────
// concentration > wash-sale > event-impact > drift > milestone > sentiment
// > idle-cash/bounce-back > earnings.
function triggerPriority(item: any): number {
  switch (item.triggerType) {
    case 'concentration_single':
    case 'concentration_top3':
      return 0;
    case 'wash_sale':
      return 1;
    case 'event_impact':
      return 2;
    case 'portfolio_drift':
      return 3;
    case 'position_milestone':
      return 4;
    case 'sentiment_shift':
      return 5;
    case 'idle_cash':
    case 'bounce_back':
      return 6;
    case 'earnings_proximity':
      return 7;
    default:
      return 10;
  }
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

// ─── Full-width 68px portfolio trend sparkline ─────────────
// Neutral line color (data display, not a CTA or gain/loss signal — the
// Today/Total figures above already carry the semantic color).
function TrendChart({ positions, cashBalance }: { positions: Position[]; cashBalance: number }) {
  const [points, setPoints] = useState<{ timestamp: number; value: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!positions || positions.length === 0) {
      setPoints([]);
      return;
    }
    (async () => {
      try {
        const res = await apiPost('/api/portfolio/chart', {
          positions: positions.map((p) => ({
            symbol: p.symbol,
            shares: p.qty,
            buyDate: p.buyDate,
            avgCost: p.avgCost,
            totalCost: p.totalCost || p.qty * p.avgCost,
          })),
          cashBalance,
          range: '1W',
        });
        if (res.ok && !cancelled) {
          const json = await res.json();
          setPoints(Array.isArray(json.points) ? json.points : []);
        }
      } catch {
        if (!cancelled) setPoints([]);
      }
    })();
    return () => { cancelled = true; };
  }, [positions, cashBalance]);

  if (!points || points.length < 2) return null;

  const H = 68;
  const pad = 3;
  const W = 360;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = points.length;
  const xFor = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const yFor = (v: number) => pad + (1 - (v - min) / range) * (H - pad * 2);
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${xFor(n - 1).toFixed(1)},${H - pad} L${xFor(0).toFixed(1)},${H - pad} Z`;

  return (
    <div style={{ marginTop: 14 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: H, display: 'block' }}
        aria-hidden="true"
        data-testid="portfolio-trend-chart"
      >
        <path d={areaPath} fill="rgba(196,204,220,0.08)" />
        <path d={linePath} fill="none" stroke="#C4CCDC" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
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
  const { user } = useAuth();
  const { setTab, setChatOpen, setPendingPrompt, setFocusPosition } = useTabStore();

  const isShowingDemo = activeAccount?.isDemo ?? false;
  const isReadOnly = !isShowingDemo && !(activeAccount?.tradingEnabled ?? false);
  const isBrokerExpected = isConnected && !isShowingDemo;

  const displayAccount = isBrokerExpected
    ? (brokerAccount as AccountSummary | null)
    : (liveAccount as AccountSummary | null);
  const loading = isBrokerExpected ? brokerLoading : liveLoading;

  const positions: Position[] = displayAccount?.positions || [];

  // ── Account name for the header ──
  const accountName = isShowingDemo ? 'Demo' : brokerMeta?.name || activeAccount?.name || 'Broker';

  // Connection dot: demo = amber, live+connected = green, live+disconnected = faint.
  const dotColor = isShowingDemo ? C.amber : isConnected ? C.gain : C.textFaint;

  // Investor style (right side of header) — plain text link to Settings.
  // `user` is Record<string, unknown> from useAuth, so coerce the style id.
  const investorStyle = (user?.investorStyle as string | undefined) || 'buffett';
  const styleLabel = getStyleContent(investorStyle).shortLabel;

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

  // Lead = highest-priority active trigger (not "first with an action").
  const leadItem = useMemo(
    () => (noticedItems.length > 0 ? [...noticedItems].sort((a, b) => triggerPriority(a) - triggerPriority(b))[0] : null),
    [noticedItems],
  );
  const secondaryItems = useMemo(
    () => (leadItem ? noticedItems.filter((i) => i !== leadItem).slice(0, 4) : []),
    [noticedItems, leadItem],
  );

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

  // Top holdings (by market value) — total P&L only.
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

  // Hero stat: numeric value if the trigger has one, else the title.
  const leadStatVal = leadItem ? leadStat(leadItem) : '';
  const leadHero = leadStatVal || (leadItem?.title ?? '');
  const leadSentence = leadStatVal ? (leadItem?.body ?? '') : '';

  // Explainability chip — data-derived caption beneath the sentence.
  const explainChip = leadItem ? explainabilityText(leadItem, positions) : '';

  // ── One-time streaming reveal for NEW lead triggers ──
  // The supporting sentence types in (30-40ms/char) the first time a given
  // trigger is shown; stat + chart render instantly. "Seen" keys persist in
  // localStorage so a trigger never re-plays on subsequent views.
  const SEEN_KEY = 'vantage:seen-lead-triggers';
  const [streamedSentence, setStreamedSentence] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  useLayoutEffect(() => {
    if (!leadItem) { setStreamedSentence(''); setIsStreaming(false); return; }
    const key = (leadItem.triggerKey || leadItem.id) as string;
    const sentence = leadStat(leadItem) ? (leadItem.body ?? '') : '';
    if (!key || !sentence) { setIsStreaming(false); setStreamedSentence(''); return; }

    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') || []; } catch { seen = []; }
    if (seen.includes(key)) { setIsStreaming(false); setStreamedSentence(''); return; }

    // New trigger → stream once.
    let i = 0;
    setIsStreaming(true);
    setStreamedSentence('');
    const id = window.setInterval(() => {
      i += 1;
      setStreamedSentence(sentence.slice(0, i));
      if (i >= sentence.length) {
        window.clearInterval(id);
        setIsStreaming(false);
        try {
          const cur = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') || [];
          if (!cur.includes(key)) localStorage.setItem(SEEN_KEY, JSON.stringify([...cur, key]));
        } catch { /* ignore */ }
      }
    }, 35);
    return () => window.clearInterval(id);
  }, [leadItem]);

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* ── 1. Header: masthead + account/status row ── */}
      <div style={{ padding: '14px 20px 0' }} data-testid="today-header">
        {/* Masthead: orb icon + "Vantage" wordmark (serif italic) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              background: 'radial-gradient(circle at 32% 30%, #9FF0F4 0%, #5FD8DE 55%, #1B7D82 100%)',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 19,
              lineHeight: 1, color: C.textPrimary, letterSpacing: '0.01em',
            }}
            data-testid="masthead-wordmark"
          >
            Vantage
          </span>
        </div>
        {/* #5FD8DE accent rule — the ONE deliberate deviation from #141C2E */}
        <div style={{ borderTop: '2px solid #5FD8DE', marginTop: 12 }} />
        {/* Account/status row (unchanged canonical one-row pattern) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
          {/* left: connection dot + account name + VIEW ONLY tag */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
            <span
              style={{
                fontSize: 14, fontWeight: 600, color: C.textPrimary,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {accountName}
            </span>
            {isReadOnly && (
              <span
                style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: C.amber,
                  border: `0.5px solid ${C.amber}`, borderRadius: 4, padding: '2px 5px',
                  whiteSpace: 'nowrap',
                }}
              >
                VIEW ONLY
              </span>
            )}
          </div>
          {/* right: investor style text link */}
          <button
            type="button"
            onClick={() => setTab('settings')}
            style={{
              background: 'none', border: 'none', color: C.accent, fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
              flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            {styleLabel}
          </button>
        </div>
        <div style={{ borderTop: '0.5px solid #141C2E', marginTop: 12 }} />
      </div>

      {/* ── 2. Lead story (full-bleed) ── */}
      {leadItem ? (
        <div style={{ padding: '22px 20px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: semanticColor(leadItem.variant) }}>
            {humanizeTrigger(leadItem.triggerType)}
          </span>
          {/* Hero stat + radial glow (subtle accent behind the number only) */}
          <div style={{ position: 'relative', marginTop: 8 }}>
            <div
              aria-hidden="true"
              data-testid="lead-stat-glow"
              style={{
                position: 'absolute',
                left: -16, top: -22, right: -8, bottom: -18,
                background: 'radial-gradient(ellipse 55% 50% at 24% 42%, rgba(95,216,222,0.16) 0%, rgba(95,216,222,0.05) 55%, transparent 75%)',
                filter: 'blur(8px)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ position: 'relative', fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 42, lineHeight: 1.05, color: C.textPrimary }} data-testid="lead-stat">
              {leadHero}
            </div>
          </div>
          {leadSentence && (
            <div
              style={{ position: 'relative', fontSize: 14, lineHeight: 1.55, color: C.textSecondary, marginTop: 10, maxWidth: 520 }}
              data-testid="lead-sentence"
              data-streaming={isStreaming ? 'true' : 'false'}
            >
              {/* invisible full sentence reserves exact height (no layout shift while typing) */}
              <span style={{ visibility: 'hidden' }} aria-hidden="true">{leadSentence}</span>
              <span style={{ position: 'absolute', left: 0, top: 0 }}>
                {isStreaming ? streamedSentence : leadSentence}
              </span>
            </div>
          )}
          {explainChip && (
            <div style={{ fontSize: 11, color: C.textFaint, marginTop: 10 }} data-testid="lead-explainability">
              {explainChip}
            </div>
          )}
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

      {/* ── 3. Secondary notices strip (horizontal scroll) ── */}
      {secondaryItems.length > 0 && (
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {secondaryItems.map((item) => (
              <div
                key={item.id}
                style={{
                  background: C.card, border: `0.5px solid ${C.cardBorder}`, borderRadius: 14,
                  padding: '12px 14px', flexShrink: 0, width: 232,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: semanticColor(item.variant), flexShrink: 0 }}>
                  {humanizeTrigger(item.triggerType)}
                </span>
                <span style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.4 }}>
                  {item.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. Portfolio section ── */}
      <div style={{ margin: '24px 20px 0' }}>
        <div style={{ borderTop: '0.5px solid #141C2E', paddingTop: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: C.textMuted }}>
            YOUR PORTFOLIO
          </div>
          <div style={{ marginTop: 12, background: C.balanceBg, border: `0.5px solid ${C.cardBorder}`, borderRadius: 16, padding: '18px 18px 16px' }}>
            {/* balance */}
            <div>
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 32, color: C.textPrimary, lineHeight: 1 }}>
                ${dollars}
              </span>
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 20, color: C.textMuted }}>
                .{cents}
              </span>
            </div>
            {/* Today / Total */}
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

            {/* full-width trend chart */}
            <TrendChart positions={positions} cashBalance={accountData.cash} />

            {/* Top holdings — "+X% · +$Y" (matches Position Detail) */}
            {topHoldings.length > 0 && (
              <div style={{ marginTop: 14, borderTop: `0.5px solid ${C.cardBorder}`, paddingTop: 12 }}>
                {topHoldings.map((p) => {
                  const pnl = p.totalPnl ?? (p.currentPrice - p.avgCost) * p.qty;
                  const pnlPct = p.totalPnlPercent ?? (p.avgCost ? (pnl / (p.avgCost * p.qty)) * 100 : 0);
                  return (
                    <div key={p.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>{p.symbol}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: pnl >= 0 ? C.gain : C.loss }}>
                        {pctStr(pnlPct)} · {fmt(pnl)}
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
      </div>
    </div>
  );
}

export default TodayTab;
