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
//   5. More from Rufus — compact secondary notices (see MoreFromRufus):
//      event-impact INFO-tier + position milestones, i.e. the items otherwise
//      only reachable through the chat "Explore" (+) picker. Deck items excluded.
//   6. Portfolio Health — deterministic score + 3 sub-scores.
//   7. Quick-links 2×2.
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
import { buildDeck, buildEarningsRows, type DeckTeaser } from '@/lib/insights/deck';
import { briefAskPrompt } from '@/lib/insights/brief';
import { Masthead } from '@/components/layout/Masthead';
import { HeroDeck } from './HeroDeck';
import { MoreFromRufus } from './MoreFromRufus';
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
  const { account: brokerAccount, accountScope: brokerScope, loading: brokerLoading, refresh: brokerRefresh } = usePortfolio();
  const { account: liveAccount, accountScope: liveScope, loading: liveLoading, brokerMeta, refresh: liveRefresh } = useLivePortfolio();
  const { isConnected } = useBroker();
  const { activeAccount, activeAccountId } = useAccounts();
  const { user } = useAuth();
  const { setTab } = useTabStore();
  const isShowingDemo = activeAccount?.isDemo ?? false;
  const isReadOnly = !isShowingDemo && !(activeAccount?.tradingEnabled ?? false);
  const isBrokerExpected = isConnected && !isShowingDemo;

  // PART 2 — SCOPE GATE. A resolved account is only valid for the account id it
  // was fetched for. If the id it carries doesn't match the currently-selected
  // account, it is the PREVIOUS account's data and must not be displayed as
  // this account's balance — not even for one frame. `null` here means "nothing
  // resolved for this account yet" → the skeleton renders instead (never a
  // number, and never another account's number).
  const scopedAccount = isBrokerExpected
    ? (brokerScope === (activeAccountId ?? null) ? (brokerAccount as AccountSummary | null) : null)
    : (liveScope === (activeAccountId ?? null) ? (liveAccount as AccountSummary | null) : null);

  const displayAccount = scopedAccount;
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

  // ── PART 5 — held-position earnings dates ("More from Rufus") ──
  // Reuses the SAME fundamentals source the Position Detail "Earnings" field
  // uses (GET /api/stock/fundamentals → nextEarningsDate). Deterministic and
  // quiet: unknown/failed lookups simply contribute no row.
  const positionSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of displayAccount?.positions || []) {
      const s = (p.symbol || '').toUpperCase();
      if (s) set.add(s);
    }
    return [...set].sort();
  }, [displayAccount]);

  const [earningsBySymbol, setEarningsBySymbol] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (positionSymbols.length === 0) { setEarningsBySymbol({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        positionSymbols.map(async (symbol) => {
          try {
            const r = await apiGet(`/api/stock/fundamentals?symbol=${encodeURIComponent(symbol)}`);
            if (!r.ok) return [symbol, null] as const;
            const d = await r.json();
            return [symbol, typeof d?.nextEarningsDate === 'string' ? d.nextEarningsDate : null] as const;
          } catch {
            return [symbol, null] as const;
          }
        }),
      );
      if (!cancelled) setEarningsBySymbol(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [positionSymbols]);

  const earningsRows = useMemo(
    () => buildEarningsRows(
      (displayAccount?.positions || []).map((p) => ({ symbol: p.symbol })),
      earningsBySymbol,
    ),
    [displayAccount, earningsBySymbol],
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

  // ── Data-readiness gate ─────────────────────────────────────
  // `displayAccount` is null until the SELECTED source has actually resolved.
  // usePortfolio() deliberately clears the account and sets `loading` the
  // moment a broker connection appears (the "bridge gap"), so that a live
  // account never shows stale demo numbers. Rendering the `equity: 0`
  // placeholder as though it were data produced a visible "$0.00" flash —
  // a WRONG number, which is worse than showing nothing. So: while the
  // account (and, for a live source, `isConnected`) has not resolved we
  // render a SKELETON, exactly like PortfolioTab's "Loading portfolio data…"
  // guard — the same data path, just with the missing loading state added.
  //
  //   ready       → real numbers
  //   pending     → skeleton (broker bridge gap / still connecting)
  //   unavailable → never resolved and nothing in flight (e.g. broker error)
  const sourceReady = !!displayAccount && (isShowingDemo || isConnected);
  const accountState: 'ready' | 'pending' | 'unavailable' = sourceReady
    ? 'ready'
    : loading || !isConnected || isShowingDemo
      ? 'pending'
      : 'unavailable';

  return (
    <div style={{ paddingBottom: 24, background: 'var(--v-canvas)', minHeight: '100%' }}>
      <Masthead
        accountName={accountName}
        brokerLabel={brokerLabel}
        dotColor={dotColor}
        isReadOnly={isReadOnly}
        styleLabel={styleLabel}
        onStyleClick={() => setTab('settings')}
        testIds={{
          masthead: 'insights-masthead',
          rule: 'masthead-rule',
          header: 'insights-header',
          wordmark: 'masthead-wordmark',
          account: 'masthead-account',
        }}
      />

      {/* ── 3. Balance section (no chart) — directly under the header ──
          This is a real CARD on the canvas (white fill in light, panel fill in
          dark, 0.5px hairline, rounded, real padding) wrapping the label, the
          serif-italic balance, Today/Total and "See Holdings →". It replaces
          the earlier bare-text-on-canvas treatment, which was the bug. */}
      <div style={{ margin: '20px 20px 0' }} data-testid="balance-block">
        {/* PART 2 — signature line: 2px accent rule directly above the card,
            same language as the masthead rule below the wordmark. Gives this
            section its own quiet identity marker, visually distinct from
            Rufus's dark-navy hero cards. */}
        <div data-testid="balance-rule" style={{ borderTop: '2px solid var(--v-accent)', marginBottom: 12 }} />
        <div
          data-testid="balance-card"
          style={{
            background: 'var(--v-por-card)',
            border: '0.5px solid var(--v-card-border)',
            borderRadius: 16,
            padding: '16px 18px 18px',
          }}
        >
          {/* label row — orb icon + label, mirroring the hero card's
              orb+"RUFUS NOTICED" treatment so the two card types read as a
              family (same 12px gradient orb, same gap). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              aria-hidden="true"
              data-testid="balance-orb"
              style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--v-orb)', flexShrink: 0 }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)' }}>
              YOUR PORTFOLIO
            </span>
          </div>
          <div data-testid="balance-section" style={{ marginTop: 12 }}>
            {accountState === 'ready' ? (
              <div>
                <span
                  data-testid="balance-amount"
                  style={{ fontFamily: 'var(--font-sans, Inter, sans-serif)', fontWeight: 800, letterSpacing: '-0.02em', fontSize: 44, color: 'var(--v-text-primary)', lineHeight: 1 }}
                >
                  ${dollars}
                </span>
                <span style={{ fontFamily: 'var(--font-sans, Inter, sans-serif)', fontWeight: 700, fontSize: 26, color: 'var(--v-text-muted)' }}>
                  .{cents}
                </span>
              </div>
            ) : (
              // No number until we actually have one. A shimmer placeholder keeps
              // the card's height (no layout jump) without implying a value.
              <span
                data-testid={accountState === 'pending' ? 'balance-skeleton' : 'balance-unavailable'}
                className={accountState === 'pending' ? 'v-skel' : undefined}
                style={{ width: 172, height: 30, borderRadius: 8 }}
                aria-hidden="true"
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              {accountState === 'ready' ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                    Today{' '}
                    {/* PART 2 — colour follows the REAL SIGN of this figure
                        (never a fixed colour per figure). */}
                    <span data-testid="today-figure" style={{ color: accountData.dayPnl == null ? 'var(--v-text-muted)' : accountData.dayPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 700 }}>
                      {accountData.dayPnl == null ? '—' : `${fmt(accountData.dayPnl)} (${pctStr(accountData.dayPnlPercent)})`}
                    </span>
                  </span>
                  <span style={{ color: 'var(--v-text-faint)', fontSize: 12 }}>·</span>
                </>
              ) : accountState === 'pending' ? (
                <span
                  data-testid="balance-skeleton-meta"
                  className="v-skel"
                  style={{ width: 148, height: 12, borderRadius: 6 }}
                  aria-hidden="true"
                />
              ) : (
                <span data-testid="balance-unavailable-meta" style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                  Couldn’t load this account — reconnect or refresh.
                </span>
              )}
              {accountState === 'ready' && (
                <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                  Total{' '}
                  {/* PART 2 — independent of Today: loss-red whenever the TOTAL
                      return is negative, even on a day where Today is up. */}
                  <span data-testid="total-figure" style={{ color: accountData.totalPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 700 }}>
                    {fmt(accountData.totalPnl)} ({pctStr(accountData.totalPnlPercent)})
                  </span>
                </span>
              )}
            </div>
            <button
              type="button"
              data-testid="see-holdings"
              onClick={() => setTab('portfolio')}
              style={{
                display: 'inline-block', marginTop: 14, background: 'none', border: 'none',
                color: 'var(--v-accent-label)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3,
              }}
            >
              See Holdings →
            </button>
          </div>
        </div>
      </div>

      {/* ── 4. Hero deck (or single fallback card) ──
          SHARED HEADER (PART 1): orb + "RUFUS NOTICED" renders exactly ONCE,
          hoisted OUT of the individual cards and OUTSIDE the horizontal
          scroller (so swiping between cards cannot move it). It is NOT sticky —
          it scrolls with the page like every other section header.

          3-TIER EMPTY-STATE RULE (deck.length > 0 already encodes tiers A+B,
          because buildDeck() only returns [] when there is no eligible trigger
          AND no brief teaser with a headline):
            (a) real trigger active         → header + deck shows the card
            (b) no trigger, teaser exists   → header + deck shows teaser card(s)
            (c) genuinely nothing           → header does NOT render AND the
                fallback "no action needed" card does NOT render (both gone).
          The fallback card therefore survives ONLY for the middle ground where
          Rufus HAS produced notices but none are deck-eligible — a truthful
          "no action needed", not an empty shell. */}
      <div style={{ marginTop: 18 }}>
        {deck.length > 0 && (
          <div
            data-testid="rufus-noticed-header"
            style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 20px 10px' }}
          >
            <span
              aria-hidden="true"
              style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--v-orb)', flexShrink: 0 }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)' }}>
              RUFUS NOTICED
            </span>
          </div>
        )}
        {deck.length > 0 ? (
          <HeroDeck
            cards={deck}
            positions={positions}
            isReadOnly={isReadOnly}
            onDismiss={handleDismiss}
            onOpenTeaser={openTeaser}
          />
        ) : noticedItems.length > 0 ? (
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
        ) : null}
      </div>

      {/* ── 5. More from Rufus ──
          Directly below the deck's dot indicator, above Portfolio Health.
          Only event-impact INFO-tier + milestone items; deck items excluded.
          Renders nothing when there is nothing to surface. */}
      <MoreFromRufus items={noticedItems} earnings={earningsRows} />

      {/* ── 6. Portfolio Health ──
          Gated on the same readiness flag: with no holdings yet the scorer
          returns 0 / "Needs attention", which would flash a wrong verdict for
          exactly the same reason the balance used to flash $0.00. */}
      <PortfolioHealthCard
        positions={positions}
        cash={accountData.cash || 0}
        totalPnlPercent={accountData.totalPnlPercent || 0}
        riskTolerance={riskTolerance}
        pending={accountState === 'pending'}
        failed={accountState === 'unavailable'}
        onRetry={() => { (isBrokerExpected ? brokerRefresh : liveRefresh)?.(); }}
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
