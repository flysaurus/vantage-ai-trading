'use client';

// ─── PositionDetail ─────────────────────────────────────────
// THE single canonical Position Detail screen (PART 2). A full-screen overlay
// reachable IDENTICALLY from:
//   (a) an Insights deck notice's "Review <SYM>" action
//       (meta.action = REVIEW_POSITION:<SYM> → openPositionDetail), and
//   (b) tapping a Holdings position row.
// There is exactly ONE implementation — no compressed/second variant.
//
// Back returns to the ORIGINATING list and restores its exact scroll offset
// (captured on open in the store). Buy More = filled teal (primary CTA);
// Sell = outlined red. Both are hidden on read-only (VIEW ONLY) accounts.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTabStore } from '@/store';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePositionLots } from '@/hooks/usePositionLots';
import { useDisplayAccount } from '@/hooks/useDisplayAccount';
import { getActiveLotCount, formatFIFOLabel } from '@/lib/fifo-engine';
import { avatarColor, initials } from '@/lib/position-avatar';
import type { Position } from '@/types';

const DOLLAR_FMT: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const fmt = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;
const pctStr = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/** Deterministic avatar tint per ticker — shared with the Holdings row list. */

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

export function PositionDetail() {
  const { positionDetail, closePositionDetail, setTab, requestTrade } = useTabStore();
  const { user } = useAuth();
  const { positions, loading, isReadOnly } = useDisplayAccount();
  const [profile, setProfile] = useState<{ name?: string; sector?: string } | null>(null);

  const symbol = positionDetail?.symbol || '';
  const origin = positionDetail?.origin || 'portfolio';
  const originScrollTop = positionDetail?.scrollTop ?? 0;

  const pos = useMemo<Position | null>(() => {
    if (!symbol) return null;
    const up = symbol.toUpperCase();
    return (positions.find((p) => (p.symbol || '').toUpperCase() === up) as Position) ||
      (positions.find((p) => (p.symbol || '').toUpperCase() === up) as Position) ||
      null;
  }, [symbol, positions]);

  const { lots, loading: lotsLoading } = usePositionLots(user?.id as string | undefined, symbol, null, !!symbol);
  const activeLots = getActiveLotCount(lots);
  const fifoLabel = formatFIFOLabel(activeLots, activeLots > 1);

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
  const marketValue = pos?.marketValue ?? (pos ? pos.qty * pos.currentPrice : 0);
  const costBasis = pos?.totalCost ?? (pos ? pos.qty * pos.avgCost : 0);
  const totalPnl = pos?.totalPnl ?? marketValue - costBasis;
  const totalPnlPct = pos?.totalPnlPercent ?? (costBasis > 0 ? (totalPnl / costBasis) * 100 : 0);
  const hasToday = pos?.dayChange != null;
  const tint = avatarColor(symbol);

  const originLabel = origin === 'insights' ? 'Insights' : origin === 'invest' ? 'Invest' : 'Holdings';

  return (
    <div
      data-testid="position-detail"
      data-symbol={symbol}
      style={{ position: 'fixed', inset: 0, zIndex: 99995, background: 'var(--v-canvas)', display: 'flex', flexDirection: 'column' }}
    >
      {/* Scroller */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 40 }}>
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
              <span data-testid="position-detail-today" style={{ color: !hasToday ? 'var(--v-text-muted)' : (pos!.dayChange ?? 0) >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 700 }}>
                {!hasToday ? '—' : `${fmt(pos!.dayChange)} (${pctStr(pos!.dayChangePercent)})`}
              </span>
            </span>
            <span style={{ color: 'var(--v-text-faint)', fontSize: 12 }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
              Total{' '}
              <span data-testid="position-detail-total" style={{ color: totalPnl >= 0 ? 'var(--v-gain)' : 'var(--v-loss)', fontWeight: 700 }}>
                {fmt(totalPnl)} ({pctStr(totalPnlPct)})
              </span>
            </span>
          </div>
        </div>

        {/* ── Stats ── */}
        <div style={{ margin: '14px 20px 0', background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 16, padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
          <StatCell label="Shares" value={pos ? (pos.qty % 1 === 0 ? String(pos.qty) : pos.qty.toFixed(4)) : '—'} />
          <StatCell label="Avg Cost" value={pos ? fmt(pos.avgCost) : '—'} />
          <StatCell label="Cost Basis" value={pos ? fmt(costBasis) : '—'} />
          <StatCell label="Lots" value={fifoLabel || (lotsLoading ? '…' : '—')} />
        </div>

        {/* ── Lots & cost basis ── */}
        {lots.length > 0 && (
          <div style={{ margin: '18px 20px 0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)', marginBottom: 10 }}>LOTS &amp; COST BASIS</div>
            <div style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.4fr', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--v-card-border)', fontSize: 9, fontWeight: 700, color: 'var(--v-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <span>Qty</span><span>Fill</span><span>Value</span><span>Date</span>
              </div>
              {lots.filter((l) => l.remaining_qty > 0).map((l) => (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.4fr', gap: 4, padding: '9px 12px', borderBottom: '1px solid var(--v-card-border)', fontSize: 12, color: 'var(--v-text-secondary)' }}>
                  <span style={{ fontWeight: 700, color: 'var(--v-text-primary)' }}>{l.remaining_qty}</span>
                  <span>{fmt(l.price_at_fill)}</span>
                  <span>{fmt(l.remaining_qty * l.price_at_fill)}</span>
                  <span>{new Date(l.filled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Trade CTAs (hidden on read-only accounts) ── */}
        {!isReadOnly && pos && (
          <div style={{ display: 'flex', gap: 12, padding: '22px 20px 0' }}>
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

        {!pos && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--v-text-muted)', fontSize: 14 }} data-testid="position-detail-empty">
            {loading ? 'Loading position…' : `No position for ${symbol} in this account.`}
          </div>
        )}
      </div>
    </div>
  );
}

export default PositionDetail;
