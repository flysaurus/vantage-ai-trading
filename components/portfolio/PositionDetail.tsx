'use client';

// ─── PositionDetail ─────────────────────────────────────────
// THE single canonical Position Detail screen. A full-screen overlay
// reachable IDENTICALLY from:
//   (a) an Insights deck notice's "Review <SYM>" action
//       (meta.action = REVIEW_POSITION:<SYM> → openPositionDetail), and
//   (b) tapping a Holdings position row.
// There is exactly ONE implementation — no compressed/second variant.
//
// Back returns to the ORIGINATING list and restores its exact scroll offset
// (captured on open in the store). Buy More = filled teal (primary CTA);
// Sell = outlined red. Both are hidden on read-only (VIEW ONLY) accounts and
// pinned as a sticky footer so they are reachable without scrolling.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTabStore } from '@/store';
import { useReconstructedLots } from '@/hooks/useReconstructedLots';
import { useDisplayAccount } from '@/hooks/useDisplayAccount';
import { useAccountLotsScope } from '@/hooks/useAccountLotsScope';
import { getActiveLotCount, formatFIFOLabel } from '@/lib/fifo-engine';
import { AnalystConsensus, NO_ANALYST_COVERAGE, ANALYST_UNAVAILABLE } from '@/components/shared/AnalystConsensus';
import type { AnalystSummary } from '@/lib/market-data';
import { avatarColor, initials } from '@/lib/position-avatar';
import { PositionDetailChart } from './PositionDetailChart';
import type { Position } from '@/types';

const DOLLAR_FMT: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const fmt = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;
const pctStr = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/** Compact market-cap formatter: $x.xxT / $x.xB / $x.xM. */
const fmtCap = (n: number) => {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
};
const fmtVol = (n: number) => `${(n / 1e6).toFixed(1)}M`;
/** Quantities: whole shares stay whole, fractional shares get at most 4dp (no 529.508744588). */
const fmtQty = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(4).replace(/\.?0+$/, ''));

const SECTION_HEADING: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  color: 'var(--v-text-muted)',
  textTransform: 'uppercase',
};

interface Fundamentals {
  eps: number | null;
  pe: number | null;
  dividendYield: number | null;
  dividendRate: number | null;
  recommendation: string | null;
  numAnalysts: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  beta: number | null;
  nextEarningsDate: string | null;
  /** Analyst consensus block from the provider (aggregate, no per-analyst dedupe). */
  analyst: AnalystSummary | null;
}

/**
 * Fundamentals object with every numeric field null. Used for symbols the
 * provider genuinely has no fundamentals for (index ETFs) - the analyst block
 * then carries `coverage:false` so the card renders a lone "No analyst
 * coverage" row instead of disappearing. Pass ANALYST_UNAVAILABLE when the
 * lookup itself failed, so the row reads "temporarily unavailable" instead.
 */
const emptyFundamentals = (analyst: AnalystSummary = NO_ANALYST_COVERAGE): Fundamentals => ({
  eps: null, pe: null, dividendYield: null, dividendRate: null,
  recommendation: null, numAnalysts: null, marketCap: null,
  volume: null, avgVolume: null, dayHigh: null, dayLow: null,
  beta: null, nextEarningsDate: null, analyst,
});

interface NewsItem {
  title: string;
  link: string;
  publisher: string;
  pubDate: string;
  sentiment?: { label: 'positive' | 'negative' | 'neutral'; score: number };
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--v-text-muted)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, color: color || 'var(--v-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  );
}

function FundCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--v-text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--v-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</div>
    </div>
  );
}

export function PositionDetail() {
  const { positionDetail, closePositionDetail, setTab, requestTrade } = useTabStore();
  const { positions, loading, isReadOnly } = useDisplayAccount();
  const [profile, setProfile] = useState<{ name?: string; sector?: string } | null>(null);

  // ── Canonical enrichment data (chart / fundamentals / news) ──
  const [sparkline, setSparkline] = useState<{ points: { t: number; c: number }[]; high52w: number | null; low52w: number | null; current: number | null } | null>(null);
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);

  const symbol = positionDetail?.symbol || '';
  const origin = positionDetail?.origin || 'portfolio';
  const originScrollTop = positionDetail?.scrollTop ?? 0;

  // Real single lookup by uppercased symbol.
  const pos = useMemo<Position | null>(() => {
    if (!symbol) return null;
    const up = symbol.toUpperCase();
    return (positions.find((p) => (p.symbol || '').toUpperCase() === up) as Position) || null;
  }, [symbol, positions]);

  // ── Account-scoped real lots ──
  // The route wants the raw SnapTrade connection id (no `snaptrade:` prefix)
  // for a live/paper account, or `demo=1` for the demo portfolio. Scope is
  // resolved ONCE in hooks/useAccountLotsScope so Detail and the Holdings
  // card can never disagree about which account's lots they are reading.
  const { connectionId: activeConnectionId, isDemo: isDemoAccount } = useAccountLotsScope();

  const { lots, unknownStart, windowStartDate, loading: lotsLoading } = useReconstructedLots({
    connectionId: activeConnectionId,
    isDemo: isDemoAccount,
    symbol,
    enabled: !!symbol,
  });
  const activeLots = getActiveLotCount(lots);
  // Known lots only tell part of the story when shares predate the activity
  // window — never present the count as the whole position.
  const knownLotsLabel = formatFIFOLabel(activeLots, activeLots > 1);
  const fifoLabel = unknownStart
    ? knownLotsLabel
      ? `${knownLotsLabel}+`
      : '1+' // only undated shares on file — at least one lot predates the window
    : knownLotsLabel;

  // Hydrate company name / sector if the row didn't carry them.
  useEffect(() => {
    setProfile(null);
    if (!symbol) return;
    const needName = !pos?.name || pos.name === pos.symbol;
    const needSector = !pos?.sector;
    if (!needName && !needSector) return;
    let cancelled = false;
    fetch(`/api/company/profile?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j) setProfile({ name: j.name, sector: j.sector }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbol, pos?.name, pos?.sector]);

  // Fetch chart + fundamentals + news in ONE pass when the overlay opens.
  // Promise.allSettled + per-source ok-guards + cancelled flag, silent catch.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setSparkline(null);
    setFundamentals(null);
    setNewsItems([]);

    (async () => {
      const [sparkRes, fundRes, newsRes] = await Promise.allSettled([
        fetch(`/api/market/sparkline?symbol=${encodeURIComponent(symbol)}`),
        fetch(`/api/stock/fundamentals?symbol=${encodeURIComponent(symbol)}`),
        fetch(`/api/stock/news?symbol=${encodeURIComponent(symbol)}&count=3`),
      ]);

      try {
        if (sparkRes.status === 'fulfilled' && sparkRes.value.ok && !cancelled) {
          const data = await sparkRes.value.json();
          if (!cancelled && data?.points?.length >= 2) {
            setSparkline({
              points: data.points,
              high52w: data.high52w ?? null,
              low52w: data.low52w ?? null,
              current: data.current ?? null,
            });
          }
        }
      } catch { /* silent */ }

      try {
        if (fundRes.status === 'fulfilled' && fundRes.value.ok && !cancelled) {
          const fData = await fundRes.value.json();
          if (!cancelled && fData?.symbol) {
            setFundamentals({
              eps: fData.eps ?? null,
              pe: fData.pe ?? null,
              dividendYield: fData.dividendYield ?? null,
              dividendRate: fData.dividendRate ?? null,
              recommendation: fData.recommendation ?? null,
              numAnalysts: fData.numAnalysts ?? null,
              analyst: fData.analyst ?? NO_ANALYST_COVERAGE,
              marketCap: fData.marketCap ?? null,
              volume: fData.volume ?? null,
              avgVolume: fData.avgVolume ?? null,
              dayHigh: fData.dayHigh ?? null,
              dayLow: fData.dayLow ?? null,
              beta: fData.beta ?? null,
              nextEarningsDate: fData.nextEarningsDate ?? null,
            });
          } else if (!cancelled) {
            setFundamentals(emptyFundamentals());
          }
        } else if (!cancelled) {
          // 503/network failure or a request that never resolved. Say so - it
          // must NOT masquerade as "No analyst coverage".
          setFundamentals(emptyFundamentals(ANALYST_UNAVAILABLE));
        }
      } catch {
        if (!cancelled) setFundamentals(emptyFundamentals(ANALYST_UNAVAILABLE));
      }

      try {
        if (newsRes.status === 'fulfilled' && newsRes.value.ok && !cancelled) {
          const nData = await newsRes.value.json();
          if (!cancelled && Array.isArray(nData?.news)) setNewsItems(nData.news.slice(0, 3));
        }
      } catch { /* silent */ }
    })();

    return () => { cancelled = true; };
  }, [symbol]);

  // Restore the originating list's scroll position when the overlay closes.
  // We set it on the next frame(s) so the tab swap (if any) has painted.
  const restoreRef = useRef(originScrollTop);
  useEffect(() => { restoreRef.current = originScrollTop; }, [originScrollTop]);

  if (!positionDetail) return null;

  const handleBack = () => {
    const target = restoreRef.current;
    if (origin !== useTabStore.getState().activeTab) setTab(origin);
    closePositionDetail();
    const apply = () => {
      const el = document.querySelector('[data-page-scroller]') as HTMLElement | null;
      if (el) el.scrollTop = target;
      if (typeof window !== 'undefined') window.scrollTo(0, target);
    };
    requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
    setTimeout(apply, 60);
  };

  const name = profile?.name || pos?.name || symbol;
  const sector = profile?.sector || pos?.sector;
  // Current price drives the per-lot Gain/Loss column (same source the Total line uses).
  const currentPrice = pos?.currentPrice ?? null;
  const marketValue = pos?.marketValue ?? (pos ? pos.qty * pos.currentPrice : 0);
  const costBasis = pos?.totalCost ?? (pos ? pos.qty * pos.avgCost : 0);
  const totalPnl = pos?.totalPnl ?? marketValue - costBasis;
  const totalPnlPct = pos?.totalPnlPercent ?? (costBasis > 0 ? (totalPnl / costBasis) * 100 : 0);
  const hasToday = pos?.dayChange != null;
  const tint = avatarColor(symbol);

  const originLabel = origin === 'insights' ? 'Insights' : origin === 'invest' ? 'Invest' : 'Holdings';

  // ── Fundamentals rendering gates ──
  const hasFund =
    !!fundamentals &&
    [
      fundamentals.marketCap,
      fundamentals.pe,
      fundamentals.eps,
      fundamentals.dividendYield,
      fundamentals.dividendRate,
      fundamentals.recommendation,
      fundamentals.dayHigh,
      fundamentals.dayLow,
      fundamentals.volume,
      fundamentals.beta,
      fundamentals.nextEarningsDate,
      fundamentals.analyst,
    ].some((v) => v != null);

  return (
    <div
      data-testid="position-detail"
      data-symbol={symbol}
      style={{ position: 'fixed', inset: 0, zIndex: 99995, background: 'var(--v-canvas)', display: 'flex', flexDirection: 'column' }}
    >
      {/* Scroller */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 24 }}>
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
          <button
            type="button"
            data-testid="position-detail-back"
            onClick={handleBack}
            aria-label={`Back to ${originLabel}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--v-accent-label)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {originLabel}
          </button>
        </div>

        {/* ── Identity ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 20px 0' }}>
          <span
            aria-hidden="true"
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tint.bg, color: tint.fg, fontWeight: 800, fontSize: 15 }}
          >
            {initials(symbol)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--v-text-primary)', letterSpacing: '-0.01em' }}>{symbol}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--v-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40ch' }}>
              {name}{sector ? ` · ${sector}` : ''}
            </div>
          </div>
        </div>

        {/* ── Value block ── */}
        <div style={{ margin: '18px 20px 0', background: 'var(--v-por-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 16, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)' }}>MARKET VALUE</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, letterSpacing: '-0.02em', fontSize: 34, color: 'var(--v-text-primary)', lineHeight: 1.1, marginTop: 6 }}>
            {pos ? fmt(marketValue) : '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
              Today{' '}
              <span data-testid="position-detail-today" style={{ color: !hasToday ? 'var(--v-text-muted)' : (pos!.dayChange ?? 0) >= 0 ? 'var(--v-gain-label)' : 'var(--v-loss-label)', fontWeight: 700 }}>
                {!hasToday ? '—' : `${fmt(pos!.dayChange)} (${pctStr(pos!.dayChangePercent)})`}
              </span>
            </span>
            <span style={{ color: 'var(--v-text-faint)', fontSize: 12 }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
              Total{' '}
              <span data-testid="position-detail-total" style={{ color: totalPnl >= 0 ? 'var(--v-gain-label)' : 'var(--v-loss-label)', fontWeight: 700 }}>
                {fmt(totalPnl)} ({pctStr(totalPnlPct)})
              </span>
            </span>
          </div>
        </div>

        {/* ── Stats ── */}
        <div style={{ margin: '14px 20px 0', background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 16, padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
          <StatCell label="Shares" value={pos ? fmtQty(pos.qty) : '—'} />
          <StatCell label="Avg Cost" value={pos ? fmt(pos.avgCost) : '—'} />
          <StatCell label="Cost Basis" value={pos ? fmt(costBasis) : '—'} />
          <StatCell label="Lots" value={fifoLabel || (lotsLoading ? '…' : '—')} />
        </div>

        {/* ── 52-week price chart ── */}
        {sparkline && sparkline.points.length >= 2 && (
          <PositionDetailChart
            symbol={symbol}
            points={sparkline.points}
            high52w={sparkline.high52w}
            low52w={sparkline.low52w}
            current={sparkline.current}
          />
        )}

        {/* ── Fundamentals ── */}
        {hasFund && fundamentals && (
          <div data-testid="position-detail-fundamentals" style={{ margin: '18px 20px 0' }}>
            <div style={{ ...SECTION_HEADING, marginBottom: 10 }}>FUNDAMENTALS</div>
            <div style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
                {fundamentals.marketCap != null && <FundCell label="Mkt Cap">{fmtCap(fundamentals.marketCap)}</FundCell>}
                {fundamentals.pe != null && <FundCell label="P/E">{fundamentals.pe.toFixed(1)}</FundCell>}
                {fundamentals.eps != null && <FundCell label="EPS">${fundamentals.eps.toFixed(2)}</FundCell>}
                <FundCell label="Div Yield">
                  {fundamentals.dividendYield != null && fundamentals.dividendYield > 0
                    ? `${fundamentals.dividendYield.toFixed(2)}%`
                    : '—'}
                </FundCell>
                <FundCell label="Div Amt">
                  {fundamentals.dividendRate != null && fundamentals.dividendRate > 0
                    ? `$${fundamentals.dividendRate.toFixed(2)}/yr`
                    : '—'}
                </FundCell>

                {/* Analyst row — full width, its own line in the grid (two lines
                    collapsed, distribution + target range when expanded).
                    This is the single analyst surface: the old ad-hoc
                    recommendation badge was folded into this row. */}
                <AnalystConsensus
                  analyst={fundamentals.analyst}
                  buttonStyle={{ gridColumn: '1 / -1', padding: '10px 12px', borderRadius: 10 }}
                  panelStyle={{ gridColumn: '1 / -1' }}
                />
              </div>

              {(fundamentals.dayHigh != null || fundamentals.volume != null || fundamentals.beta != null || fundamentals.nextEarningsDate) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--v-card-border)' }}>
                  {fundamentals.dayHigh != null && fundamentals.dayLow != null && (
                    <FundCell label="Day Range">${fundamentals.dayLow.toFixed(2)} – ${fundamentals.dayHigh.toFixed(2)}</FundCell>
                  )}
                  {fundamentals.volume != null && (
                    <FundCell label="Volume">
                      {fmtVol(fundamentals.volume)}
                      {fundamentals.avgVolume != null && (
                        <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--v-text-muted)', marginLeft: 5 }}>
                          avg {fmtVol(fundamentals.avgVolume)}
                        </span>
                      )}
                    </FundCell>
                  )}
                  {fundamentals.beta != null && <FundCell label="Beta">{fundamentals.beta.toFixed(2)}</FundCell>}
                  {fundamentals.nextEarningsDate && (
                    <FundCell label="Next Earnings">
                      {new Date(fundamentals.nextEarningsDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </FundCell>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Lots & cost basis ── */}
        {(lots.length > 0 || unknownStart) && (
          <div style={{ margin: '18px 20px 0' }}>
            <div style={{ ...SECTION_HEADING, marginBottom: 10 }}>LOTS &amp; COST BASIS</div>

            {/* Unknown-start disclosure — deliberately prominent, directly ABOVE the
                table. Shares that predate the broker's transaction history have no
                purchase date on file, so the lots below UNDERSTATE the position.
                This is the long-held core-position case and must never be a footnote. */}
            {unknownStart && (
              <div
                data-testid="position-detail-unknown-start"
                style={{ padding: '10px 14px', background: 'var(--v-warn-dim)', border: '1px dashed var(--v-warn)', borderRadius: 10, fontSize: 11.5, color: 'var(--v-warn)', marginBottom: 10, lineHeight: 1.5 }}
              >
                <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ {unknownStart.label}</div>
                <div style={{ color: 'var(--v-text-secondary)' }}>
                  {fmtQty(unknownStart.sharesHeldBeforeWindow)} shares in this position were held before your broker&apos;s
                  transaction history begins
                  {windowStartDate
                    ? ` (${new Date(windowStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`
                    : ''}
                  , so they have no purchase date on file and the lots below understate the position.
                </div>
              </div>
            )}

            {lots.length > 0 && (
              <div
                data-testid="position-detail-lots"
                style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 14, overflow: 'hidden' }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1fr 1.3fr 1.3fr 1.3fr', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--v-card-border)', fontSize: 9, fontWeight: 700, color: 'var(--v-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <span>Qty</span><span>Fill</span><span>Cost basis</span><span>Date</span><span>Gain/Loss</span>
                </div>
                {lots.filter((l) => l.remaining_qty > 0).map((l) => {
                  const lotPnl =
                    currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0
                      ? l.remaining_qty * (currentPrice - l.price_at_fill)
                      : null;
                  return (
                    <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '0.9fr 1fr 1.3fr 1.3fr 1.3fr', gap: 4, padding: '9px 12px', borderBottom: '1px solid var(--v-card-border)', fontSize: 12, color: 'var(--v-text-secondary)' }}>
                      <span style={{ fontWeight: 700, color: 'var(--v-text-primary)' }}>{fmtQty(l.remaining_qty)}</span>
                      <span>{fmt(l.price_at_fill)}</span>
                      <span>{fmt(l.remaining_qty * l.price_at_fill)}</span>
                      <span>{new Date(l.filled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: lotPnl == null ? 'var(--v-text-muted)' : lotPnl >= 0 ? 'var(--v-gain-label)' : 'var(--v-loss-label)',
                        }}
                      >
                        {lotPnl == null ? '—' : `${lotPnl >= 0 ? '+' : '-'}$${Math.abs(lotPnl).toLocaleString('en-US', DOLLAR_FMT)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Related News ── */}
        {newsItems.length > 0 && (
          <div data-testid="position-detail-news" style={{ margin: '18px 20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={SECTION_HEADING}>RELATED NEWS</div>
              <span style={{ fontSize: 10, color: 'var(--v-text-faint)', fontStyle: 'italic', flexShrink: 0 }}>
                Sentiment reflects article tone, not investment advice.
              </span>
            </div>
            <div style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 14, overflow: 'hidden' }}>
              {newsItems.map((item, i) => {
                const daysAgo = item.pubDate
                  ? Math.round((Date.now() - new Date(item.pubDate).getTime()) / (1000 * 60 * 60 * 24))
                  : null;
                const timeLabel =
                  daysAgo != null
                    ? daysAgo <= 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`
                    : '';
                const sent = item.sentiment?.label;
                const sentStyle =
                  sent === 'positive'
                    ? { fg: 'var(--v-gain-label)', bg: 'var(--v-gain-dim)' }
                    : sent === 'negative'
                      ? { fg: 'var(--v-loss-label)', bg: 'var(--v-loss-dim)' }
                      : { fg: 'var(--v-warn)', bg: 'var(--v-warn-dim)' };
                return (
                  <a
                    key={i}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      textDecoration: 'none',
                      color: 'inherit',
                      padding: '11px 13px',
                      borderBottom: i < newsItems.length - 1 ? '1px solid var(--v-card-border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--v-text-primary)', lineHeight: 1.4 }}>
                        {item.title}
                      </div>
                      {sent && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: sentStyle.fg,
                            background: sentStyle.bg,
                            borderRadius: 4,
                            padding: '1px 6px',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            marginTop: 1,
                            textTransform: 'capitalize',
                          }}
                        >
                          {sent}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10.5, color: 'var(--v-text-muted)' }}>
                      {item.publisher && <span>{item.publisher}</span>}
                      {timeLabel && <span style={{ color: 'var(--v-text-faint)' }}>· {timeLabel}</span>}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {!pos && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--v-text-muted)', fontSize: 14 }} data-testid="position-detail-empty">
            {loading ? 'Loading position…' : `No position for ${symbol} in this account.`}
          </div>
        )}
      </div>

      {/* ── Sticky trade CTAs (hidden on read-only accounts) ── */}
      {!isReadOnly && pos && (
        <div
          style={{
            flexShrink: 0,
            padding: '12px 20px calc(12px + env(safe-area-inset-bottom))',
            background: 'var(--v-canvas)',
            borderTop: '1px solid var(--v-card-border)',
            display: 'flex',
            gap: 12,
          }}
        >
          <button
            type="button"
            data-testid="position-detail-buy"
            onClick={() => requestTrade(symbol, 'BUY')}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12, border: 'none',
              background: 'var(--v-accent)', color: 'var(--v-accent-text)',
              fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            }}
          >
            Buy More
          </button>
          <button
            type="button"
            data-testid="position-detail-sell"
            onClick={() => requestTrade(symbol, 'SELL')}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12,
              background: 'transparent', border: '1.5px solid var(--v-loss)', color: 'var(--v-loss)',
              fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            }}
          >
            Sell
          </button>
        </div>
      )}
    </div>
  );
}

export default PositionDetail;
