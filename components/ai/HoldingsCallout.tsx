'use client';
// ─── HoldingsCallout — renders the user's live positions as a data panel ───
// The server emits a `dataCallout` SSE event carrying ONLY scope + tickers
// (decided deterministically from the classified intent). This component renders
// the actual numbers from the client's OWN live PortfolioContext — never from
// server-sent values, so it can't drift or be hallucinated.
//
// scope = 'holdings'  → full holdings (rule 1+2: portfolio_relative_question,
//                        account_state).
// scope = 'positions' → only the held tickers in `tickers` (rule 3: ticker
//                        intersection for research/comparative questions).
//
// THEMING CONTRACT (round 5): every text/fill/border below is an EXPLICIT
// `--v-chat-*` / `--v-gain` / `--v-loss` token — never a literal white (or any
// other hardcoded color) and never a reliance on an inherited color. The card
// renders inside the chat panel, so it must be legible in Light AND Dark; a
// near-white literal (e.g. #e2e8f0 for the dollar value) is invisible on the
// Light panel — that was a real shipped bug.
import type { AccountSummary } from '@/types';

export interface HoldingsCalloutProps {
  account: AccountSummary | null;
  scope: 'holdings' | 'positions';
  tickers?: string[] | null;
}

const usd = (n: number | undefined | null) =>
  `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Theme-aware gain/loss. Chat-scoped tokens — the app-wide --v-gain/--v-loss
 *  light values are not AA-legible on the light chat surface. */
const pctColor = (v: number | undefined | null) =>
  (v ?? 0) > 0.0001 ? 'var(--v-chat-gain)'
    : (v ?? 0) < -0.0001 ? 'var(--v-chat-loss)'
      : 'var(--v-chat-text-3)';

export function HoldingsCallout({ account, scope, tickers }: HoldingsCalloutProps) {
  if (!account) return null;
  const all = account.positions || [];
  let positions = all;
  if (scope === 'positions' && Array.isArray(tickers) && tickers.length > 0) {
    const wanted = new Set(tickers.map(t => t.toUpperCase()));
    positions = all.filter(p => wanted.has((p.symbol || '').toUpperCase()));
  }
  if (positions.length === 0) return null;

  return (
    <div
      data-testid="holdings-callout"
      style={{
        margin: '10px 0 6px 0',
        background: 'var(--v-chat-fill)',
        border: '1px solid var(--v-chat-accent-border)',
        borderRadius: '12px',
        padding: '12px 14px',
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--v-chat-accent)',
          }}
        >
          📊 Your Holdings
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--v-chat-accent)',
            background: 'var(--v-chat-accent-soft)',
            border: '1px solid var(--v-chat-accent-border)',
            borderRadius: '999px',
            padding: '2px 9px',
            whiteSpace: 'nowrap',
          }}
        >
          {positions.length} position{positions.length === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {positions.map((p, i) => (
          <div
            key={`${p.symbol}-${i}`}
            data-testid={`holdings-row-${p.symbol}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              padding: '7px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--v-chat-border)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v-chat-text)', whiteSpace: 'nowrap' }}>
                {p.symbol}
                {p.name ? (
                  <span style={{ color: 'var(--v-chat-text-3)', fontWeight: 600, fontSize: '12px' }}> — {p.name}</span>
                ) : null}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--v-chat-text-3)', marginTop: '1px' }}>
                {p.qty != null ? `${p.qty} sh` : ''}
                {p.portfolioPercent != null && !Number.isNaN(p.portfolioPercent)
                  ? `${p.qty != null ? ' · ' : ''}${p.portfolioPercent.toFixed(1)}% of portfolio`
                  : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div data-testid={`holdings-value-${p.symbol}`} style={{ fontSize: '13px', fontWeight: 700, color: 'var(--v-chat-text)' }}>
                {usd(p.marketValue)}
              </div>
              <div data-testid={`holdings-pct-${p.symbol}`} style={{ fontSize: '11px', fontWeight: 600, color: pctColor(p.dayChangePercent) }}>
                {p.dayChangePercent != null && !Number.isNaN(p.dayChangePercent)
                  ? `${p.dayChangePercent >= 0 ? '+' : ''}${p.dayChangePercent.toFixed(2)}%`
                  : '\u00A0'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
