'use client';

/**
 * AnalystConsensus — the ONE rendering of analyst consensus in the app.
 *
 * Collapsed:  ANALYST / <Consensus> · N analysts / Avg target $X · +/-Y%
 * Expanded:   tier distribution bar + price-target range + 90-day firm activity
 *             + source/date + disclaimer
 * No data:    "No analyst coverage" (index ETFs — verified universal for funds)
 * Failed:     "Analyst data temporarily unavailable" (provider 429/401/network)
 *
 * Every number comes from the SAME upstream source: Yahoo's
 * `recommendationTrend[0]` bucket (counts) + `financialData` target prices, via
 * AnalystSummary in lib/market-data.ts. Four call sites used to render their own
 * version of this — three of them inventing a rating from a coarser field and
 * hardcoding the colour — so the component owns it now:
 *   - PositionDetail (portfolio detail screen)
 *   - PortfolioTab (portfolio inline detail card)
 *   - PositionCardV3 (basket card — dark interior)
 *
 * The expand/collapse chrome is components/shared/ExpandableRow, the same
 * component the Wash Sale Rule row on Tax Harvesting uses.
 */

import { useState } from 'react';
import type { AnalystSummary } from '@/lib/market-data';
import ExpandableRow from './ExpandableRow';

/**
 * Colours are grouped per surface so no call site hand-picks a hex again.
 *
 * `darkIsland` exists because basket/position card interiors are dark in BOTH
 * themes by design; the theme tokens would resolve to their LIGHT values there
 * and the text would be near-invisible. Its values are the dark-theme ramp from
 * app/theme.css (same gain/loss/muted colours the rest of the dark UI uses).
 */
export interface AnalystPalette {
  label: string;
  primary: string;
  secondary: string;
  muted: string;
  faint: string;
  card: string;
  cardBorder: string;
  gain: string;
  gainLabel: string;
  loss: string;
  lossLabel: string;
  accentLabel: string;
}

export const THEMED_PALETTE: AnalystPalette = {
  label: 'var(--v-text-muted)',
  primary: 'var(--v-text-primary)',
  secondary: 'var(--v-text-secondary)',
  muted: 'var(--v-text-muted)',
  faint: 'var(--v-text-faint)',
  card: 'var(--v-card)',
  cardBorder: 'var(--v-card-border)',
  gain: 'var(--v-gain)',
  gainLabel: 'var(--v-gain-label)',
  loss: 'var(--v-loss)',
  lossLabel: 'var(--v-loss-label)',
  accentLabel: 'var(--v-accent-label)',
};

export const DARK_ISLAND_PALETTE: AnalystPalette = {
  label: '#8794a8',
  primary: '#ffffff',
  secondary: '#aab4c7',
  muted: '#8794a8',
  faint: '#6b7688',
  card: 'rgba(255,255,255,0.03)',
  cardBorder: 'rgba(255,255,255,0.10)',
  gain: '#3ddc84',
  gainLabel: '#3ddc84',
  loss: '#f0716b',
  lossLabel: '#f0716b',
  accentLabel: '#5fd8de',
};

/**
 * Sentinels for the two "no numbers" states, exported so every call site uses
 * the same objects. `NO_ANALYST_COVERAGE` = the provider answered and nobody
 * covers this symbol (index ETFs: SPY/VOO/QQQ/XLF/…). `ANALYST_UNAVAILABLE` =
 * we could not get an answer (429/401/network) — never rendered as "no coverage".
 */
export const NO_ANALYST_COVERAGE: AnalystSummary = {
  coverage: false,
  distribution: null,
  distributionPeriod: null,
  analystCount: null,
  consensus: null,
  currentPrice: null,
  targetLow: null,
  targetMean: null,
  targetMedian: null,
  targetHigh: null,
  upsidePct: null,
  recentFirmCount90d: null,
  latestRatingDate: null,
  provider: 'Yahoo Finance',
  asOf: '',
};

export const ANALYST_UNAVAILABLE: AnalystSummary = {
  ...NO_ANALYST_COVERAGE,
  unavailable: true,
};

export interface AnalystConsensusProps {
  analyst: AnalystSummary | null;
  /** `darkIsland` for dark card interiors; defaults to the theme tokens. */
  variant?: 'themed' | 'darkIsland';
  /** Base testid. Override when several instances share a page. */
  testId?: string;
  /** Merge into the header button / panel styles (e.g. gridColumn: '1 / -1'). */
  buttonStyle?: React.CSSProperties;
  panelStyle?: React.CSSProperties;
  /** Rule + label above the values. Off inside compact cards. */
  showLabel?: boolean;
}

export function AnalystConsensus({
  analyst,
  variant = 'themed',
  testId = 'analyst-row',
  buttonStyle,
  panelStyle,
  showLabel = true,
}: AnalystConsensusProps) {
  const [open, setOpen] = useState(false);
  const c = variant === 'darkIsland' ? DARK_ISLAND_PALETTE : THEMED_PALETTE;

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
    color: c.label, textTransform: 'uppercase',
  };

  const d = analyst?.distribution ?? null;
  const total = analyst?.analystCount ?? 0;

  // ── State 1: the lookup failed. NOT the same as "nobody covers this". ──
  if (analyst?.unavailable) {
    return (
      <div data-testid={testId} data-coverage="unavailable" style={{ width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {showLabel && <div style={labelStyle}>Analyst</div>}
          <div data-testid={`${testId}-unavailable`} style={{ fontSize: 13.5, fontWeight: 700, color: c.muted }}>
            Analyst data temporarily unavailable
          </div>
        </div>
      </div>
    );
  }

  // ── State 2: genuinely uncovered (index ETFs: SPY/VOO/QQQ/XLF/XLP/…). ──
  if (!analyst || !analyst.coverage || !analyst.consensus || !d || total <= 0) {
    return (
      <div data-testid={testId} data-coverage="none" style={{ width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {showLabel && <div style={labelStyle}>Analyst</div>}
          <div data-testid={`${testId}-no-coverage`} style={{ fontSize: 13.5, fontWeight: 700, color: c.secondary }}>
            No analyst coverage
          </div>
        </div>
      </div>
    );
  }

  // Bar fills: in dark mode `--v-gain-label` IS `--v-gain` (same for loss), so
  // the inner tiers are differentiated with opacity on the BAR only. Legend text
  // keeps full-strength label colours so nothing small loses contrast.
  const tiers = [
    { key: 'strongBuy', label: 'Strong Buy', n: d.strongBuy, color: c.gainLabel, textColor: c.gainLabel, opacity: 1 },
    { key: 'buy', label: 'Buy', n: d.buy, color: c.gain, textColor: c.gainLabel, opacity: 0.62 },
    { key: 'hold', label: 'Hold', n: d.hold, color: c.muted, textColor: c.muted, opacity: 1 },
    { key: 'sell', label: 'Sell', n: d.sell, color: c.loss, textColor: c.lossLabel, opacity: 0.62 },
    { key: 'strongSell', label: 'Strong Sell', n: d.strongSell, color: c.lossLabel, textColor: c.lossLabel, opacity: 1 },
  ];
  const shown = tiers.filter((t) => t.n > 0);
  const up = analyst.upsidePct;
  const upColor = up == null ? c.secondary : up >= 0 ? c.gainLabel : c.lossLabel;
  const money = (v: number | null) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Where the live price sits against the low→high target band.
  const lo = analyst.targetLow;
  const hi = analyst.targetHigh;
  const px = analyst.currentPrice;
  const pxPct = lo != null && hi != null && px != null && hi > lo ? Math.min(100, Math.max(0, ((px - lo) / (hi - lo)) * 100)) : null;

  return (
    <ExpandableRow
      testId={testId}
      panelTestId={`${testId}-panel`}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      buttonStyle={buttonStyle}
      panelStyle={panelStyle}
      tone={variant === 'darkIsland' ? 'plain' : 'card'}
      header={
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          {showLabel && <span style={labelStyle}>Analyst</span>}
          <span style={{ fontSize: 13.5, fontWeight: 700, color: c.primary }}>
            {analyst.consensus}
            <span style={{ color: c.secondary, fontWeight: 600 }}>
              {' · '}{total} {total === 1 ? 'analyst' : 'analysts'}
            </span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: c.secondary }}>
            Avg target {money(analyst.targetMean)}
            {up != null && (
              <span data-testid={`${testId}-upside`} style={{ color: upColor, fontWeight: 700 }}>
                {' · '}{up >= 0 ? '+' : ''}{up.toFixed(1)}%
              </span>
            )}
          </span>
        </span>
      }
    >
      {/* Rating distribution — the provider's own current-month buckets, which is
          why the label count above matches the sum of these tiers exactly. */}
      <div data-testid={`${testId}-distribution`}>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: c.cardBorder }}>
          {tiers.map((t) =>
            t.n > 0 ? <div key={t.key} style={{ width: `${(t.n / total) * 100}%`, background: t.color, opacity: t.opacity }} /> : null
          )}
        </div>
        <div style={{ marginTop: 7, fontSize: 11, color: c.secondary }}>
          {shown.map((t, i) => (
            <span key={t.key}>
              {i > 0 && <span style={{ color: c.faint }}> · </span>}
              <span style={{ color: t.textColor, fontWeight: 700 }}>{t.n}</span> {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* Price target range with the live price marked on the same scale. */}
      <div data-testid={`${testId}-target-range`} style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: c.muted, fontWeight: 600 }}>
          <span>Low {money(lo)}</span>
          {/* Mean, the same figure as the collapsed "Avg target" line - the panel
              must not quote a median while the summary quotes a mean. */}
          <span>Avg {money(analyst.targetMean)}</span>
          <span>High {money(hi)}</span>
        </div>
        <div style={{ position: 'relative', height: 4, marginTop: 6, background: c.cardBorder, borderRadius: 2 }}>
          {pxPct != null && (
            <div
              title={`Current ${money(px)}`}
              style={{ position: 'absolute', left: `${pxPct}%`, top: -4, width: 2, height: 12, borderRadius: 1, background: c.accentLabel }}
            />
          )}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: c.secondary }}>
          Current <span style={{ color: c.primary, fontWeight: 700 }}>{money(px)}</span>
          {up != null && (
            <span>
              {' · '}
              <span style={{ color: upColor, fontWeight: 700 }}>
                {up >= 0 ? '+' : ''}{up.toFixed(1)}% to avg target
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Directional colour, not a consensus number: how many distinct firms
          published ANY rating action in the last 90 days. */}
      {analyst.recentFirmCount90d != null && analyst.recentFirmCount90d > 0 && (
        <div data-testid={`${testId}-recent-activity`} style={{ marginTop: 12, fontSize: 11, color: c.secondary }}>
          <span style={{ color: c.primary, fontWeight: 700 }}>{analyst.recentFirmCount90d}</span>
          {analyst.recentFirmCount90d === 1 ? ' firm updated its rating' : ' firms updated their ratings'}
          {' in the last 90 days'}
          {analyst.latestRatingDate ? (
            <span style={{ color: c.muted }}>{' · most recent '}{analyst.latestRatingDate}</span>
          ) : null}
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.cardBorder}`, fontSize: 10.5, color: c.muted }}>
        Ratings from {analyst.provider} · current-month snapshot{analyst.asOf ? ` · as of ${analyst.asOf}` : ''}
      </div>
      <div style={{ marginTop: 6, fontSize: 10.5, color: c.muted }}>
        Third-party analyst opinions, not a Vantage or Rufus recommendation.
      </div>
    </ExpandableRow>
  );
}

export default AnalystConsensus;
