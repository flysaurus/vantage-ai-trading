// ─── Insights tab: shared formatting + trigger classification ───
// Pure, dependency-free helpers. No React, no fetch — safe for both
// the Insights screen and vitest.
//
// IMPORTANT: nothing in here re-implements trigger logic. It only
// reads the trigger objects the existing noticed pipeline already
// produces (lib/noticed/*) and decides how to *present* them.

/* ── Number formatting ─────────────────────────────────────── */

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

// Null/undefined = unavailable (no usable quote) → '—', never a fabricated $0.00.
export const fmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', DOLLAR_FMT)}`;

export const pctStr = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function splitCents(value: number): { dollars: string; cents: string } {
  const str = value.toLocaleString('en-US', DOLLAR_FMT);
  const parts = str.split('.');
  return { dollars: parts[0] || '0', cents: parts[1] || '00' };
}

export function formatRelativeTime(dateStr: string): string {
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

/* ── Trigger presentation ──────────────────────────────────── */

/** Category label shown above the hero stat on a deck card. */
export function humanizeTrigger(triggerType: string): string {
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

/** Variant → semantic CSS var (theme-aware). */
export function semanticColorVar(variant: string): string {
  if (variant === 'warn') return 'var(--v-admin-label)';
  if (variant === 'gain') return 'var(--v-gain)';
  return 'var(--v-accent)';
}

/**
 * The single number that belongs at serif-italic hero size.
 * Returns '' when a trigger has no clean number.
 */
export function leadStat(item: any): string {
  const m = item?.meta || {};
  const num = (v: any) => (v == null ? NaN : Number(v));
  switch (item?.triggerType) {
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
    case 'event_impact': {
      // Events read better with the ticker as the hero than a bare number.
      return typeof m.symbol === 'string' ? m.symbol : '';
    }
    default:
      return '';
  }
}

/** Data-derived caption beneath a card's supporting sentence. */
export function explainabilityText(item: any, positions: { symbol: string }[]): string {
  const m = item?.meta || {};
  const total = positions.length;
  switch (item?.triggerType) {
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
    case 'bounce_back':
      return m.symbol ? `Based on ${m.symbol} price history` : 'Based on recent price movement';
    case 'event_impact':
      return m.symbol && m.category
        ? `Based on ${m.symbol} ${String(m.category).replace(/_/g, ' ')} coverage`
        : 'Based on recent news coverage';
    default:
      return 'Based on your current holdings';
  }
}

/** Where a card's secondary "read more" link should land. */
export function followUpPrompt(item: any): string {
  const m = item?.meta || {};
  switch (item?.triggerType) {
    case 'concentration_single':
      return `Should I trim ${m.symbol} to reduce single-name risk?`;
    case 'concentration_top3': {
      const syms = Array.isArray(m.symbols) ? m.symbols.join(', ') : '';
      return syms
        ? `How should I diversify beyond ${syms}?`
        : 'How should I diversify my portfolio?';
    }
    case 'idle_cash': {
      const a = Number(m.amount);
      return Number.isFinite(a) && a > 0
        ? `Build me a portfolio with my $${a.toLocaleString('en-US')} of idle cash.`
        : 'What should I do with my idle cash?';
    }
    case 'bounce_back':
      return m.symbol ? `Is ${m.symbol} a buy after this pullback?` : 'Is this pullback a buy?';
    case 'event_impact':
      return m.symbol
        ? `What does this event mean for ${m.symbol}?`
        : 'What does this event mean for my portfolio?';
    default:
      return item?.followUp || 'Tell me more about this.';
  }
}
