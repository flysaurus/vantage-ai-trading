// ─── Insights hero deck: single card ────────────────────────
// Visual container for one deck entry. Two shapes:
//   • trigger card  — orb + RUFUS NOTICED, category label, serif-italic
//     hero stat (+the one approved glow exception), supporting sentence,
//     data caption, chart/donut, action row (primary CTA + secondary text
//     link + "Remind in Nd" snooze).
//   • teaser card   — Daily Brief / Weekly Snapshot headline synthesis.
//
// ⚠️ NO TRIGGER LOGIC LIVES HERE. Every number comes from the trigger's
// own `meta` (produced by lib/noticed/*) or from the same computed
// position data the concentration trigger uses. Nothing is re-derived.

'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Position } from '@/types';
import { useTabStore } from '@/store';
import {
  humanizeTrigger,
  leadStat,
  explainabilityText,
  followUpPrompt,
} from '@/lib/insights/format';
import type { DeckCard } from '@/lib/insights/deck';

/* ── Semantic color on the (always dark-navy) hero island ──── */
function heroSemantic(variant: string): string {
  if (variant === 'warn') return 'var(--v-hero-warn)';
  if (variant === 'gain') return 'var(--v-hero-gain)';
  return 'var(--v-hero-accent)';
}

/* ── Real-holdings donut (same computation as the concentration
      trigger: position market values as portfolio weights). ── */

interface DonutSlice { symbol: string; pct: number; color: string }

const DONUT_COLORS = ['var(--v-hero-warn)', 'var(--v-hero-accent)', '#8fa0c4'];
const DONUT_OTHER_COLOR = 'rgba(255,255,255,0.28)';

/** Rank real positions by market value and bucket everything past `topN`
 *  into a single "Other" slice. Unchanged weighting math — the same
 *  marketValue / total the concentration trigger itself uses. */
function donutSlices(positions: Position[], topN = 3): DonutSlice[] {
  const total = positions.reduce((s, p) => s + (p.marketValue || 0), 0);
  if (total <= 0) return [];
  const ranked = [...positions]
    .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
    .map((p) => ({ symbol: p.symbol, pct: ((p.marketValue || 0) / total) * 100 }));
  const top = ranked.slice(0, Math.max(1, topN));
  const restPct = Math.max(0, 100 - top.reduce((s, d) => s + d.pct, 0));
  const slices: DonutSlice[] = top.map((d, i) => ({ ...d, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  if (restPct > 0.5) slices.push({ symbol: 'Other', pct: restPct, color: DONUT_OTHER_COLOR });
  return slices;
}

/** The ring itself — identical geometry in every donut variant. */
function DonutRing({ slices, size, stroke }: { slices: DonutSlice[]; size: number; stroke: number }) {
  const box = 80;
  const R = (box - stroke) / 2 - 1;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} style={{ flexShrink: 0 }} aria-hidden="true">
      <g transform={`rotate(-90 ${box / 2} ${box / 2})`}>
        {slices.map((s) => {
          const len = (s.pct / 100) * C;
          const el = (
            <circle
              key={s.symbol}
              cx={box / 2}
              cy={box / 2}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </g>
    </svg>
  );
}

/** Wide variant: ring on the left, full legend beside it.
 *  Used by non-concentration cards that show a donut. */
export function HoldingsDonut({ positions }: { positions: Position[] }) {
  const slices = useMemo(() => donutSlices(positions, 3), [positions]);
  if (slices.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
      <DonutRing slices={slices} size={80} stroke={10} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {slices.slice(0, 4).map((d) => (
          <div key={d.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--v-hero-text-2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 700, color: 'var(--v-hero-text)', whiteSpace: 'nowrap' }}>{d.symbol}</span>
            <span style={{ color: 'var(--v-hero-text-3)' }}>{d.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Narrow variant for the concentration card's compact top row: 66px ring
 *  with a 2-line legend stacked DIRECTLY BENEATH it — the single largest
 *  holding + one "Other" aggregate. Never lists every position.
 *
 *  Alignment contract: the legend block is constrained to the ring's own
 *  width (RING_SIZE) and centred, so its edges line up with the ring — no
 *  `margin-left: auto` on the pct spans (that right-aligns to the flex
 *  container, not to the ring). */
const RING_SIZE = 66;
const RING_STROKE = 10;

export function HoldingsDonutColumn({ positions }: { positions: Position[] }) {
  const slices = useMemo(() => donutSlices(positions, 1), [positions]);
  if (slices.length === 0) return null;
  return (
    <div
      data-testid="donut-column"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: '100%' }}
    >
      <DonutRing slices={slices} size={RING_SIZE} stroke={RING_STROKE} />
      <div
        data-testid="donut-legend"
        style={{ display: 'flex', flexDirection: 'column', gap: 3, width: RING_SIZE, maxWidth: '100%' }}
      >
        {slices.slice(0, 3).map((d) => (
          <div
            key={d.symbol}
            data-testid="donut-legend-row"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, lineHeight: 1.15 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span
              style={{ fontWeight: 700, color: 'var(--v-hero-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
            >
              {d.symbol}
            </span>
            <span style={{ color: 'var(--v-hero-text-3)', marginLeft: 'auto' }}>{d.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Discount/valuation sparkline for bounce-back cards (real meta only). */
function BounceChart({ item }: { item: any }) {
  const m = item?.meta || {};
  const cur = Number(m.discountType === 'pb' ? m.pbCurrent : m.peCurrent);
  const avg = Number(m.discountType === 'pb' ? m.pbAvg : m.peAvg);
  if (!Number.isFinite(cur) || !Number.isFinite(avg) || avg <= 0) return null;
  const label = m.discountType === 'pb' ? 'P/B' : 'P/E';
  const W = 200;
  const H = 44;
  const maxV = Math.max(cur, avg) * 1.15;
  const x = (v: number) => 4 + (v / maxV) * (W - 8);
  return (
    <div style={{ marginTop: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }} aria-hidden="true">
        <line x1={x(avg)} y1="2" x2={x(avg)} y2={H - 2} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3 3" />
        <line x1={x(cur)} y1="2" x2={x(cur)} y2={H - 2} stroke="var(--v-hero-accent)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--v-hero-text-3)', marginTop: 2 }}>
        <span>{label} {cur.toFixed(2)} now</span>
        <span>{m.years ? `${m.years}-yr avg ` : 'avg '}{avg.toFixed(2)}</span>
      </div>
    </div>
  );
}

interface InsightCardProps {
  card: DeckCard;
  positions: Position[];
  isReadOnly: boolean;
  /** Opens the "Remind in Nd" picker for this deck card. */
  onSnooze: (itemId: string) => void;
  /** Teaser cards open their existing screens. */
  onOpenTeaser: (kind: 'daily_brief' | 'weekly_snapshot') => void;
  width?: number | string;
}

export function InsightCard({ card, positions, isReadOnly, onSnooze, onOpenTeaser, width = 300 }: InsightCardProps) {
  const router = useRouter();
  const { setTab, setChatOpen, setPendingPrompt, setFocusPosition, openPositionDetail } = useTabStore();
  const item = card.item;

  /* ── Teaser card (Daily Brief / Weekly Snapshot) ── */
  if (card.kind !== 'trigger' || !item) {
    const t = card.teaser!;
    return (
      <article
        className="insight-card"
        data-testid="insight-card"
        data-card-kind={card.kind}
        data-card-id={card.id}
        style={cardStyle(width)}
      >
        {/* No per-card orb + "RUFUS NOTICED" row any more — that label is now a
            single shared header rendered ONCE above the deck (see InsightsTab).
            The card leads directly with its category label. */}
        <TeaserBody teaser={t} />
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="card-primary-cta"
            onClick={(e) => { e.stopPropagation(); onOpenTeaser(card.kind as 'daily_brief' | 'weekly_snapshot'); }}
            style={primaryBtnStyle}
          >
            {card.kind === 'daily_brief' ? "Read today's brief" : 'Read this week’s snapshot'}
          </button>
        </div>
      </article>
    );
  }

  /* ── Trigger card ── */
  const action: string = item.action || '';
  const stat = leadStat(item);
  const hero = stat || item.title || '';
  const sentence = stat ? (item.body || item.title || '') : '';
  const caption = explainabilityText(item, positions);

  const showDonut =
    action === 'REBALANCE' ||
    item.triggerType === 'concentration_single' ||
    item.triggerType === 'concentration_top3';

  /* ── Two-column treatment applies to the CONCENTRATION-RISK card ONLY.
        Other hero card types (event-impact, bounce-back, idle-cash) keep
        their existing single-column layouts. ── */
  const isConcentration =
    item.triggerType === 'concentration_single' || item.triggerType === 'concentration_top3';

  // Deep-link into the REAL Portfolio Rebalancing activation flow — the SAME
  // route the Invest tab (TradeTab) and StrategySheet's Execute button push.
  // No parallel flow, no new router.
  const openAutoRebalancing = () => router.push('/strategies/setup/rebalancing');

  const primary = buildPrimaryAction({ action, item, isReadOnly, setPendingPrompt, setChatOpen, setFocusPosition, openPositionDetail, setTab, positions });
  const secondary = buildSecondaryAction({ item, setPendingPrompt, setChatOpen });

  /* Shared pieces — identical in both layouts, so the concentration split
     never duplicates (or diverges from) the standard card's content. */
  const categoryEl = (
    <div style={{ ...categoryStyle, color: heroSemantic(item.variant) }}>
      {humanizeTrigger(item.triggerType)}
    </div>
  );

  const statEl = (fontSize: number) => (
    <div style={{ position: 'relative', marginTop: 4 }}>
      <div
        aria-hidden="true"
        data-testid="hero-stat-glow"
        style={{
          position: 'absolute',
          left: -18, top: -20, right: -10, bottom: -16,
          background: 'radial-gradient(ellipse 55% 50% at 24% 42%, var(--v-glow) 0%, transparent 72%)',
          filter: 'blur(8px)',
          pointerEvents: 'none',
        }}
      />
      <div
        data-testid="hero-stat"
        style={{
          position: 'relative',
          fontFamily: 'var(--font-sans, Inter, sans-serif)',
          fontWeight: 800,
          fontSize,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          color: 'var(--v-hero-text)',
        }}
      >
        {hero}
      </div>
    </div>
  );

  const sentenceEl = sentence ? (
    <p
      data-testid="card-sentence"
      style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--v-hero-text-2)', marginTop: 9, overflowWrap: 'anywhere' }}
    >
      {sentence}
    </p>
  ) : null;

  const captionEl = caption ? (
    <div
      data-testid="card-caption"
      style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--v-hero-text-3)', marginTop: 6, overflowWrap: 'anywhere' }}
    >
      {caption}
    </div>
  ) : null;

  return (
    <article
      className="insight-card"
      data-testid="insight-card"
      data-card-kind={card.kind}
      data-card-id={card.id}
      data-trigger-type={item.triggerType}
      style={cardStyle(width)}
    >
      {/* Card leads directly with its category label — the orb + "RUFUS NOTICED"
          row now lives in the shared deck header above the scroller. */}
      {isConcentration ? (
        /* ── CONCENTRATION CARD ──
           Row 1 (compact): category + stat (~28px) on the left, the 66px
           donut with its 2-line legend (top holding + "Other") on the right.
           Then the supporting sentence AND the sub-line render FULL-WIDTH
           beneath that row — spanning the whole card — so they never wrap in
           a narrow column beside the donut (the previous 4-line-wrap cause).
           The action area below is TWO compact rows: primary
           Review + Set up auto-rebalancing, then the lighter Ask Rufus +
           Remind row (see the action-row block further down). */
        <>
          <div
            data-testid="concentration-top-row"
            style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 0, minWidth: 0 }}
          >
            {/* No donut/legend on the concentration card — the stat carries it.
                The row is gone entirely rather than left as an empty slot, so the
                freed vertical space is reclaimed (card is shorter, no dead gap). */}
            {categoryEl}
            {statEl(28)}
          </div>
          {sentenceEl}
          {captionEl}
        </>
      ) : (
        <>
          {/* category label */}
          {categoryEl}

          {/* hero stat + the one approved glow exception */}
          {statEl(34)}

          {sentenceEl}
          {captionEl}

          {showDonut && <HoldingsDonut positions={positions} />}
          {item.triggerType === 'bounce_back' && <BounceChart item={item} />}
        </>
      )}

      {/* action area — explicit taps only; swipe never reaches these.
          • CONCENTRATION CARD → TWO compact rows.
            Row 1 (primary):   Review <sym>  · Set up auto-rebalancing →
            Row 2 (secondary,
            reduced weight):     Ask Rufus →  · Remind in Nd
            The secondary row is deliberately lighter (smaller/looser type)
            so the card stays compact and never grows back to its earlier
            bloated size — the primary row carries the visual weight.
          • Every OTHER card → the original SINGLE nowrap line, unchanged. */}
      {isConcentration ? (
        <div
          data-testid="card-action-row"
          data-layout="two-row"
          style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10, minWidth: 0 }}
        >
          {/* Row 1 — primary */}
          <div
            data-testid="card-action-row-primary"
            style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}
          >
            {primary && (
              <button
                type="button"
                data-testid="card-primary-cta"
                onClick={(e) => { e.stopPropagation(); primary.onClick(); }}
                style={primarySlimStyle}
              >
                {primary.label}
              </button>
            )}
            <button
              type="button"
              data-testid="card-set-up-auto-rebalancing"
              data-branch="flow"
              onClick={(e) => { e.stopPropagation(); openAutoRebalancing(); }}
              style={autoRebalanceLinkStyle}
            >
              Set up auto-rebalancing →
            </button>
          </div>
          {/* Row 2 — secondary, reduced weight */}
          <div
            data-testid="card-action-row-secondary"
            style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}
          >
            {secondary && (
              <button
                type="button"
                data-testid="card-secondary-link"
                onClick={(e) => { e.stopPropagation(); secondary.onClick(); }}
                style={secondaryLinkStyle}
              >
                {secondary.label} →
              </button>
            )}
            <button
              type="button"
              data-testid="card-snooze"
              onClick={(e) => { e.stopPropagation(); onSnooze(item.id); }}
              style={snoozeSlimStyle}
            >
              Remind in 5d
            </button>
          </div>
        </div>
      ) : (
      <div
        data-testid="card-action-row"
        style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 14, flexWrap: 'nowrap', minWidth: 0 }}
      >
        {primary && (
          <button
            type="button"
            data-testid="card-primary-cta"
            onClick={(e) => { e.stopPropagation(); primary.onClick(); }}
            style={primaryBtnStyle}
          >
            {primary.label}
          </button>
        )}
        {secondary && (
          <button
            type="button"
            data-testid="card-secondary-link"
            onClick={(e) => { e.stopPropagation(); secondary.onClick(); }}
            style={rufusLinkStyle}
          >
            {secondary.label} →
          </button>
        )}
        <button
          type="button"
          data-testid="card-snooze"
          onClick={(e) => { e.stopPropagation(); onSnooze(item.id); }}
          style={snoozeBtnStyle}
        >
          Remind in 5d
        </button>
      </div>
      )}
    </article>
  );
}

/* ── Sub-pieces + styles ───────────────────────────────────── */

function TeaserBody({ teaser }: { teaser: { label: string; headline: string; body?: string } }) {
  return (
    <>
      <div style={{ ...categoryStyle, color: 'var(--v-hero-accent)' }}>{teaser.label}</div>
      <div
        data-testid="hero-stat"
        style={{
          fontFamily: 'var(--font-sans, Inter, sans-serif)',
          fontWeight: 800,
          fontSize: 19,
          lineHeight: 1.3,
          color: 'var(--v-hero-text)',
          marginTop: 6,
          position: 'relative',
        }}
      >
        {teaser.headline}
      </div>
      {teaser.body && (
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--v-hero-text-2)', marginTop: 10 }}>
          {teaser.body}
        </p>
      )}
    </>
  );
}

const cardStyle = (width: number | string): React.CSSProperties => ({
  flex: '0 0 auto',
  width,
  scrollSnapAlign: 'center',
  background: 'var(--v-hero-card)',
  border: '0.5px solid var(--v-hero-card-border)',
  borderRadius: 20,
  // Tightened from '16px 16px 14px' after hoisting the orb + "RUFUS NOTICED"
  // row out of the card: a full row (~12px + its gap) is gone, so the card is
  // shorter overall and the category label must start closer to the top edge
  // (no dead space where the old label row used to be).
  padding: '14px 16px 14px',
  boxSizing: 'border-box',
  textAlign: 'left',
});

const categoryStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: '0.08em',
  // 0 (was 10): the category label is now the card's FIRST row, so the card's
  // own padding is the only spacing above it.
  marginTop: 0,
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--v-hero-accent)',
  color: '#00272B',
  border: 'none',
  borderRadius: 9,
  padding: '9px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

// Shared "Ask Rufus" link treatment (Insights screen): accent-coloured,
// trailing arrow, NO underline. On a hero card the accent is the hero-island
// token (dark navy island in BOTH themes → never theme-flip); the canvas
// surfaces (health card, quick-links) use --v-accent.
const rufusLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--v-hero-accent)',
  padding: '9px 2px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const snoozeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--v-hero-text-3)',
  padding: '9px 2px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginLeft: 'auto',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

// Concentration-card Row 2 snooze: same label/behaviour as the shared snooze
// button, slimmer vertical padding so the secondary row stays short and the
// two-row action area does not re-bloat the card.
const snoozeSlimStyle: React.CSSProperties = { ...snoozeBtnStyle, padding: '5px 2px' };

// Concentration-card Row 1 link: the "set up the live flow" affordance sits
// beside the filled primary CTA — full-strength hero accent, compact enough to
// share the line with the CTA without wrapping the row.
const autoRebalanceLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--v-hero-accent)',
  padding: '0 2px',
  fontSize: 11.5,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

// Concentration-card primary CTA — same look as the shared primary button, a
// hair narrower so it + the auto-rebalancing link fit one line in the 300px card.
const primarySlimStyle: React.CSSProperties = { ...primaryBtnStyle, padding: '9px 12px' };

// Concentration-card Row 2 link: REDUCED weight vs Row 1 (smaller, lighter,
// looser) so the two-row action area stays compact instead of re-bloating.
const secondaryLinkStyle: React.CSSProperties = {
  ...rufusLinkStyle,
  fontSize: 11.5,
  fontWeight: 500,
  padding: '2px 2px',
};

/* ── CTA mapping (mirrors the pre-existing ActionButton semantics) ── */

interface CtaCtx {
  action: string;
  item: any;
  isReadOnly: boolean;
  positions: Position[];
  setPendingPrompt: (p: string) => void;
  setChatOpen: (o: boolean) => void;
  setFocusPosition: (s: string | null) => void;
  /** PART 2 — opens the ONE canonical full-screen Position Detail overlay. */
  openPositionDetail: (symbol: string, origin?: any) => void;
  setTab: (t: any) => void;
}

function buildPrimaryAction(ctx: CtaCtx): { label: string; onClick: () => void } | null {
  const { action, item, isReadOnly, setPendingPrompt, setChatOpen, setFocusPosition, openPositionDetail, setTab, positions } = ctx;

  const openChat = (prompt: string) => { setPendingPrompt(prompt); setChatOpen(true); };

  if (action === 'REBALANCE') {
    if (isReadOnly) return { label: 'Download', onClick: () => openChat('rebalance') };
    return { label: 'Trade', onClick: () => openChat('rebalance') };
  }

  if (action.startsWith('REVIEW_POSITION:')) {
    const ticker = action.slice('REVIEW_POSITION:'.length).trim();
    if (ticker) {
      return { label: `Review ${ticker}`, onClick: () => { if (openPositionDetail) openPositionDetail(ticker, 'insights'); else { setFocusPosition(ticker); setTab('portfolio'); } } };
    }
  }

  if (action.startsWith('INVEST_CASH:')) {
    const amount = Number(action.slice('INVEST_CASH:'.length).trim());
    if (Number.isFinite(amount) && amount > 0) {
      if (isReadOnly) return { label: 'Download', onClick: () => openChat(`Build me a portfolio with my $${amount.toLocaleString('en-US')} of idle cash.`) };
      return { label: `Invest $${amount.toLocaleString('en-US')}`, onClick: () => openChat(`Build me a portfolio with my $${amount.toLocaleString('en-US')} of idle cash.`) };
    }
  }

  // No deterministic CTA on the trigger → fall back to a grounded chat entry.
  const prompt = followUpPrompt(item);
  if (prompt) return { label: 'Ask Rufus', onClick: () => openChat(prompt) };
  return null;
}

function buildSecondaryAction(ctx: Pick<CtaCtx, 'item' | 'setPendingPrompt' | 'setChatOpen'>): { label: string; onClick: () => void } | null {
  const { item, setPendingPrompt, setChatOpen } = ctx;
  const prompt = followUpPrompt(item);
  if (!prompt) return null;
  return { label: 'Ask Rufus', onClick: () => { setPendingPrompt(prompt); setChatOpen(true); } };
}

export default InsightCard;
