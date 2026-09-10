// ─── Insights tab (replaces the old "Today" tab) ────────────
// Top-to-bottom:
//   1. Masthead — orb + serif-italic "Vantage", account name right,
//      ONE 2px accent rule beneath (#0E8C99 light / #5FD8DE dark).
//   2. Header row — connection dot + investor-style text link (left),
//      broker-aware VIEW ONLY badge (right). Single row.
//   3. Balance section (no chart) + "See Holdings →" — "YOUR PORTFOLIO".
//      Sits directly under the header, BEFORE the deck.
//   4. Hero deck — swipeable, BROWSE-ONLY (see components/insights/HeroDeck).
//      Falls back to a single "no action needed" card (no deck, no dots).
//   5. Portfolio Health — deterministic score + 3 sub-scores.
//   6. Quick-links 2×2.
//   (+ the Ask Rufus bar, rendered globally in MainApp on every tab)
//
// Serif italic is used in exactly TWO places on this screen: the "Vantage"
// masthead wordmark and the portfolio balance number. Nothing inside a hero
// deck card uses it.
//
// ⚠️ Trigger LOGIC is untouched. Every number here either comes from the
// noticed pipeline's own output or is computed deterministically in
// lib/insights/*. Milestones / info-tier events are deliberately NOT
// rendered on this screen.

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useLivePortfolio } from '@/context/PortfolioContext';
import { useAccounts } from '@/context/AccountContext';
import { useAuth } from '@/components/providers/AuthProvider';
import { getStyleContent } from '@/lib/content/investor-styles';
import { useTabStore } from '@/store';
import type { Position, AccountSummary } from '@/types';
import { apiGet, apiPost } from '@/lib/api-client';
import { fmt, pctStr, splitCents } from '@/lib/insights/format';
import { buildDeck, type DeckTeaser } from '@/lib/insights/deck';
import { briefAskPrompt } from '@/lib/insights/brief';
import { HeroDeck } from './HeroDeck';
import { PortfolioHealthCard } from './PortfolioHealthCard';
import { QuickLinks } from './QuickLinks';
import { BriefModal, type BriefKind } from './BriefModal';

function firstLine(content: string): string {
  const line = (content || '')
    .split('\n')
    .map((l) => l.replace(/^(MARKET|PORTFOLIO|WATCH|EARNINGS|SUMMARY|OVERALL HEALTH|RISK LEVEL):\s*/i, '').trim())
    .filter(Boolean)[0];
  return line || '';
}

export function InsightsTab() {
  const { account: brokerAccount, loading: brokerLoading } = usePortfolio();
  const { account: liveAccount, loading: liveLoading, brokerMeta } = useLivePortfolio();
  const { isConnected } = useBroker();
  const { activeAccount, activeAccountId } = useAccounts();
  const { user } = useAuth();
  const { setTab } = useTabStore();
  const isShowingDemo = activeAccount?.isDemo ?? false;
  const isReadOnly = !isShowingDemo && !(activeAccount?.tradingEnabled ?? false);
  const isBrokerExpected = isConnected && !isShowingDemo;

  const displayAccount = isBrokerExpected
    ? (brokerAccount as AccountSummary | null)
    : (liveAccount as AccountSummary | null);
  const loading = isBrokerExpected ? brokerLoading : liveLoading;

  const positions: Position[] = displayAccount?.positions || [];

  const accountName = isShowingDemo ? 'Demo' : brokerMeta?.name || activeAccount?.name || 'Broker';

  // Broker NAME for the VIEW ONLY badge (the account label above is often the
  // account nickname, not the broker). Falls back harmlessly when unknown.
  const brokerLabel = (
    isShowingDemo
      ? 'Demo'
      : brokerMeta?.broker || brokerMeta?.name || activeAccount?.name || 'Broker'
  ).toUpperCase();

  // Connection dot: demo = amber, live+connected = green, live+disconnected = faint.
  const dotColor = isShowingDemo ? 'var(--v-admin-label)' : isConnected ? 'var(--v-gain)' : 'var(--v-text-faint)';

  // Investor style — plain text link to Settings.
  const investorStyle = (user?.investorStyle as string | undefined) || 'buffett';
  const styleLabel = getStyleContent(investorStyle).shortLabel;

  // ── Active noticed items (unchanged pipeline) ──
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

  const handleDismiss = useCallback(async (itemId: string, dismissType: string) => {
    setNoticedItems((prev) => prev.filter((i) => i.id !== itemId));
    try { await apiPost('/api/ai/noticed/dismiss', { itemId, dismissType }); } catch { /* ignore */ }
  }, []);

  // ── Teaser content (existing cached endpoints) ──
  const [dailyTeaser, setDailyTeaser] = useState<DeckTeaser | null>(null);
  const [weeklyTeaser, setWeeklyTeaser] = useState<DeckTeaser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
        const r = await apiGet(`/api/ai/daily-brief?tz=${encodeURIComponent(tz)}&accountId=${encodeURIComponent(activeAccountId || 'demo')}`);
        if (r.ok && !cancelled) {
          const d = await r.json();
          const head = firstLine(d.content || '');
          if (head) setDailyTeaser({ label: 'DAILY BRIEF', headline: head.slice(0, 120) });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeAccountId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiGet(`/api/ai/weekly-snapshot?accountId=${encodeURIComponent(activeAccountId || 'demo')}`);
        if (r.ok && !cancelled) {
          const d = await r.json();
          const health = d.healthScore != null ? `Health ${d.healthScore}/10` : '';
          const risk = d.riskLevel ? `Risk ${String(d.riskLevel).toUpperCase()}` : '';
          const head = [health, risk].filter(Boolean).join(' · ') || firstLine(d.content || '').slice(0, 120);
          if (head) setWeeklyTeaser({ label: 'WEEKLY SNAPSHOT', headline: head, body: firstLine(d.content || '').slice(0, 140) || undefined });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeAccountId]);

  const deck = useMemo(
    () => buildDeck({ items: noticedItems, dailyBrief: dailyTeaser, weeklySnapshot: weeklyTeaser }),
    [noticedItems, dailyTeaser, weeklyTeaser],
  );

  // ── Brief modal (Daily Brief / Weekly Snapshot) ──
  // The deck teasers used to navigate to the Holdings screen, which yanked the
  // user out of Insights. They now open the full brief in a dismissible sheet
  // that sits OVER this screen — closing it returns here.
  const [briefKind, setBriefKind] = useState<BriefKind | null>(null);

  const openTeaser = useCallback((kind: 'daily_brief' | 'weekly_snapshot') => {
    setBriefKind(kind === 'daily_brief' ? 'daily' : 'weekly');
  }, []);

  // "Ask Rufus about this" — close the sheet, then hand the brief that was just
  // read to the chat as the prompt so the reply is grounded in THIS brief.
  const askRufusAboutBrief = useCallback(
    (kind: BriefKind, content: string) => {
      setBriefKind(null);
      useTabStore.getState().setPendingPrompt(briefAskPrompt(kind, content));
      useTabStore.getState().setChatOpen(true);
    },
    [],
  );

  // ── Derived account numbers (same single source of truth as before) ──
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
  const riskTolerance = (user as any)?.riskTolerance ?? (user as any)?.risk_tolerance ?? null;

  return (
    <div style={{ paddingBottom: 24, background: 'var(--v-canvas)', minHeight: '100%' }}>
      {/* ── 1. Masthead ── */}
      <div style={{ padding: '14px 20px 0' }} data-testid="insights-masthead">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: 'var(--v-orb)' }}
            />
            <span
              data-testid="masthead-wordmark"
              style={{
                fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 19,
                lineHeight: 1, color: 'var(--v-text-primary)', letterSpacing: '0.01em',
              }}
            >
              Vantage
            </span>
          </div>
          <span
            data-testid="masthead-account"
            style={{
              fontSize: 13, fontWeight: 600, color: 'var(--v-text-secondary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {accountName}
          </span>
        </div>
        {/* the ONE deliberate hairline deviation — 2px accent rule */}
        <div data-testid="masthead-rule" style={{ borderTop: '2px solid var(--v-accent)', marginTop: 12 }} />
      </div>

      {/* ── 2. Header row (single row) ── */}
      <div
        data-testid="insights-header"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '12px 20px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            data-testid="connection-dot"
            style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }}
          />
          <button
            type="button"
            onClick={() => setTab('settings')}
            style={{
              background: 'none', border: 'none', color: 'var(--v-accent)', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
              whiteSpace: 'nowrap', textDecoration: 'underline', textUnderlineOffset: 3,
            }}
          >
            {styleLabel}
          </button>
        </div>
        {isReadOnly && (
          // Two-weight badge: broker NAME in bold primary text, "view only" in
          // smaller muted text — same badge, one tint, no reflow.
          <span
            data-testid="view-only-tag"
            data-broker={brokerLabel}
            style={{
              background: 'var(--v-view-only-bg)',
              borderRadius: 6,
              padding: '4px 8px 4px 8px',
              flexShrink: 0,
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 1,
              lineHeight: 1.1,
            }}
          >
            <span
              data-testid="view-only-broker"
              style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em',
                color: 'var(--v-text-primary)', whiteSpace: 'nowrap',
              }}
            >
              {brokerLabel}
            </span>
            <span
              style={{
                fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em',
                color: 'var(--v-view-only-text)', whiteSpace: 'nowrap',
              }}
            >
              VIEW ONLY
            </span>
          </span>
        )}
      </div>

      {/* ── 3. Balance section (no chart) — directly under the header ──
          This is a real CARD on the canvas (white fill in light, panel fill in
          dark, 0.5px hairline, rounded, real padding) wrapping the label, the
          serif-italic balance, Today/Total and "See Holdings →". It replaces
          the earlier bare-text-on-canvas treatment, which was the bug. */}
      <div style={{ margin: '20px 20px 0' }} data-testid="balance-block">
        <div
          data-testid="balance-card"
          style={{
            background: 'var(--v-card)',
            border: '0.5px solid var(--v-card-border)',
            borderRadius: 16,
            padding: '16px 18px 18px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)' }}>
            YOUR PORTFOLIO
          </div>
          <div data-testid="balance-section" style={{ marginTop: 12 }}>
            <div>
              <span
                data-testid="balance-amount"
                style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 32, color: 'var(--v-text-primary)', lineHeight: 1 }}
              >
                ${dollars}
              </span>
              <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 20, color: 'var(--v-text-muted)' }}>
                .{cents}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                Today{' '}
                <span style={{ color: accountData.dayPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 600 }}>
                  {fmt(accountData.dayPnl)} ({pctStr(accountData.dayPnlPercent)})
                </span>
              </span>
              <span style={{ color: 'var(--v-text-faint)', fontSize: 12 }}>·</span>
              <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                Total{' '}
                <span style={{ color: accountData.totalPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 600 }}>
                  {fmt(accountData.totalPnl)} ({pctStr(accountData.totalPnlPercent)})
                </span>
              </span>
            </div>
            <button
              type="button"
              data-testid="see-holdings"
              onClick={() => setTab('portfolio')}
              style={{
                display: 'inline-block', marginTop: 14, background: 'none', border: 'none',
                color: 'var(--v-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3,
              }}
            >
              See Holdings →
            </button>
          </div>
        </div>
      </div>

      {/* ── 4. Hero deck (or single fallback card) ──
          The fallback is reserved for the GENUINELY-EMPTY case only (no eligible
          trigger AND no brief teaser). A teaser alone is a real, browsable deck. */}
      <div style={{ marginTop: 18 }}>
        {deck.length > 0 ? (
          <HeroDeck
            cards={deck}
            positions={positions}
            isReadOnly={isReadOnly}
            onDismiss={handleDismiss}
            onOpenTeaser={openTeaser}
          />
        ) : (
          <div style={{ padding: '0 20px' }} data-testid="deck-fallback">
            <article
              data-testid="fallback-card"
              style={{
                background: 'var(--v-hero-card)',
                border: '0.5px solid var(--v-hero-card-border)',
                borderRadius: 20,
                padding: '18px 18px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--v-orb)' }} />
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--v-hero-text-3)' }}>
                  RUFUS NOTICED
                </span>
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--v-hero-accent)', marginTop: 12 }}>
                ALL CLEAR
              </div>
              <div
                style={{
                  fontSize: 25, fontWeight: 700, lineHeight: 1.2,
                  color: 'var(--v-hero-text)', marginTop: 6,
                }}
                data-testid="fallback-headline"
              >
                No action needed
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--v-hero-text-2)', marginTop: 10 }}>
                {loading
                  ? 'Checking your accounts…'
                  : 'Nothing needs your attention right now. I’ll surface anything that does.'}
              </p>
            </article>
          </div>
        )}
      </div>

      {/* ── 5. Portfolio Health ── */}
      <PortfolioHealthCard
        positions={positions}
        cash={accountData.cash || 0}
        totalPnlPercent={accountData.totalPnlPercent || 0}
        riskTolerance={riskTolerance}
      />

      {/* ── 6. Quick-links 2×2 ── */}
      <QuickLinks items={noticedItems} />

      {/* ── Brief sheet (over this screen; closing returns to Insights) ── */}
      <BriefModal
        kind={briefKind}
        accountId={activeAccountId || 'demo'}
        onClose={() => setBriefKind(null)}
        onAskRufus={askRufusAboutBrief}
      />
    </div>
  );
}

export default InsightsTab;
