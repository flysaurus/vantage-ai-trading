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
export function HoldingsDonut({ positions }: { positions: Position[] }) {
  const data = useMemo(() => {
    const total = positions.reduce((s, p) => s + (p.marketValue || 0), 0);
    if (total <= 0) return [];
    return [...positions]
      .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
      .map((p) => ({
        symbol: p.symbol,
        pct: ((p.marketValue || 0) / total) * 100,
      }));
  }, [positions]);

  if (data.length === 0) return null;

  const top = data.slice(0, 3);
  const restPct = Math.max(0, 100 - top.reduce((s, d) => s + d.pct, 0));
  const slices = [
    ...top.map((d, i) => ({ ...d, color: ['var(--v-hero-warn)', 'var(--v-hero-accent)', '#8fa0c4'][i] })),
    ...(restPct > 0.5 ? [{ symbol: 'Other', pct: restPct, color: 'rgba(255,255,255,0.28)' }] : []),
  ];

  const R = 32;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" style={{ flexShrink: 0 }} aria-hidden="true">
        <g transform="rotate(-90 40 40)">
          {slices.map((s) => {
            const len = (s.pct / 100) * C;
            const el = (
              <circle
                key={s.symbol}
                cx="40"
                cy="40"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="10"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
      </svg>
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
  const { setTab, setChatOpen, setPendingPrompt, setFocusPosition } = useTabStore();
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
        <CardHeader />
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

  const primary = buildPrimaryAction({ action, item, isReadOnly, setPendingPrompt, setChatOpen, setFocusPosition, setTab, positions });
  const secondary = buildSecondaryAction({ item, setPendingPrompt, setChatOpen });

  return (
    <article
      className="insight-card"
      data-testid="insight-card"
      data-card-kind={card.kind}
      data-card-id={card.id}
      data-trigger-type={item.triggerType}
      style={cardStyle(width)}
    >
      <CardHeader />

      {/* category label */}
      <div style={{ ...categoryStyle, color: heroSemantic(item.variant) }}>
        {humanizeTrigger(item.triggerType)}
      </div>

      {/* hero stat + the one approved glow exception */}
      <div style={{ position: 'relative', marginTop: 6 }}>
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
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: 38,
            lineHeight: 1.05,
            color: 'var(--v-hero-text)',
          }}
        >
          {hero}
        </div>
      </div>

      {sentence && (
        <p data-testid="card-sentence" style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--v-hero-text-2)', marginTop: 10 }}>
          {sentence}
        </p>
      )}
      {caption && (
        <div data-testid="card-caption" style={{ fontSize: 11, color: 'var(--v-hero-text-3)', marginTop: 8 }}>
          {caption}
        </div>
      )}

      {showDonut && <HoldingsDonut positions={positions} />}
      {item.triggerType === 'bounce_back' && <BounceChart item={item} />}

      {/* action row — explicit taps only; swipe never reaches these */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
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
            style={secondaryLinkStyle}
          >
            {secondary.label}
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
    </article>
  );
}

/* ── Sub-pieces + styles ───────────────────────────────────── */

function CardHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span
        aria-hidden="true"
        style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--v-orb)', flexShrink: 0 }}
      />
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--v-hero-text-3)' }}>
        RUFUS NOTICED
      </span>
    </div>
  );
}

function TeaserBody({ teaser }: { teaser: { label: string; headline: string; body?: string } }) {
  return (
    <>
      <div style={{ ...categoryStyle, color: 'var(--v-hero-accent)' }}>{teaser.label}</div>
      <div
        data-testid="hero-stat"
        style={{
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontSize: 26,
          lineHeight: 1.2,
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
  padding: '18px 18px 16px',
  boxSizing: 'border-box',
  textAlign: 'left',
});

const categoryStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: '0.08em',
  marginTop: 12,
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--v-hero-accent)',
  color: '#00272B',
  border: 'none',
  borderRadius: 10,
  padding: '10px 18px',
  fontSize: 13.5,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

const secondaryLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--v-hero-accent)',
  padding: '10px 4px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  whiteSpace: 'nowrap',
};

const snoozeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--v-hero-text-3)',
  padding: '10px 4px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginLeft: 'auto',
  whiteSpace: 'nowrap',
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
  setTab: (t: any) => void;
}

function buildPrimaryAction(ctx: CtaCtx): { label: string; onClick: () => void } | null {
  const { action, item, isReadOnly, setPendingPrompt, setChatOpen, setFocusPosition, setTab, positions } = ctx;

  const openChat = (prompt: string) => { setPendingPrompt(prompt); setChatOpen(true); };

  if (action === 'REBALANCE') {
    if (isReadOnly) return { label: 'Download', onClick: () => openChat('rebalance') };
    return { label: 'Trade', onClick: () => openChat('rebalance') };
  }

  if (action.startsWith('REVIEW_POSITION:')) {
    const ticker = action.slice('REVIEW_POSITION:'.length).trim();
    if (ticker) {
      return { label: `Review ${ticker}`, onClick: () => { setFocusPosition(ticker); setTab('portfolio'); } };
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
