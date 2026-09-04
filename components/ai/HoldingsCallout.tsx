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
import type { AccountSummary } from '@/types';

export interface HoldingsCalloutProps {
  account: AccountSummary | null;
  scope: 'holdings' | 'positions';
  tickers?: string[] | null;
}

const usd = (n: number | undefined | null) =>
  `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pctColor = (v: number | undefined | null) =>
  (v ?? 0) > 0.0001 ? '#34d399' : (v ?? 0) < -0.0001 ? '#f87171' : 'rgba(255,255,255,0.4)';

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
      style={{
        margin: '10px 0 6px 0',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(34,211,238,0.22)',
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
            color: '#22d3ee',
          }}
        >
          📊 Your Holdings
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#22d3ee',
            background: 'rgba(34,211,238,0.12)',
            border: '1px solid rgba(34,211,238,0.25)',
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
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              padding: '7px 0',
              borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap' }}>
                {p.symbol}
                {p.name ? (
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: '12px' }}> — {p.name}</span>
                ) : null}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '1px' }}>
                {p.qty != null ? `${p.qty} sh` : ''}
                {p.portfolioPercent != null && !Number.isNaN(p.portfolioPercent)
                  ? `${p.qty != null ? ' · ' : ''}${p.portfolioPercent.toFixed(1)}% of portfolio`
                  : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>
                {usd(p.marketValue)}
              </div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: pctColor(p.dayChangePercent) }}>
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
