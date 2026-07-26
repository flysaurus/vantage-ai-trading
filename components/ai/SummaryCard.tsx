'use client';
// ─── SummaryCard — Structured TL;DR + allocation table above AI prose ───
// Renders when AI response contains [RECOMMEND:...] markers + [SUMMARY_TLDR:...] marker.
// Built from parsed markers (single source of truth — no prose re-derivation).

import { useCallback, useState } from 'react';
import type { Suggestion } from './InlineTradeButton';

interface SummaryCardProps {
  /** Parsed TL;DR text (from [SUMMARY_TLDR:...] marker) */
  tldr: string;
  /** Parsed trade suggestions (from [RECOMMEND:...] markers — same as inline buttons) */
  suggestions: Suggestion[];
  /** Symbol → company name map (from Finnhub) */
  symbolNames: Map<string, string>;
  /** The full AI response text — used to extract condensed rationale per position */
  proseText: string;
  /** Callback for buy button clicks */
  onTrade: (symbol: string, side: 'BUY' | 'SELL', suggestedShares?: number, suggestedAmount?: number) => void;
  /** Whether trade buttons are enabled (tier check) */
  enabled: boolean;
}

export function SummaryCard({
  tldr,
  suggestions,
  symbolNames,
  proseText,
  onTrade,
  enabled,
}: SummaryCardProps) {
  const [copied, setCopied] = useState(false);

  // Filter to BUY suggestions with dollar amounts (only these go in the table)
  const buyItems = suggestions.filter(s => s.side === 'BUY' && s.suggestedAmount && s.suggestedAmount > 0);
  if (buyItems.length === 0) return null;

  // Calculate total and percentages
  const total = buyItems.reduce((sum, s) => sum + (s.suggestedAmount || 0), 0);
  if (total === 0) return null;

  // ── Extract condensed rationale per ticker from prose ──
  const getRationale = (symbol: string): string => {
    // Find sentences containing the ticker
    const sentences = proseText.match(/[^.!?\n]+[.!?]+/g) || [];
    const matching = sentences
      .filter(s => new RegExp(`\\b${symbol}\\b`).test(s))
      .slice(0, 2); // Max 2 sentences per ticker

    if (matching.length === 0) return '';
    // Take the most substantive sentence (longest)
    const best = matching.reduce((a, b) => a.length >= b.length ? a : b, '');
    // Truncate to ~120 chars
    return best.length > 120 ? best.slice(0, 117) + '...' : best;
  };

  // ── Build copy text ──
  const buildCopyText = useCallback(() => {
    const lines: string[] = [];
    lines.push('📊 Portfolio Summary');
    lines.push(tldr);
    lines.push('');
    lines.push('| Ticker | Allocation | Amount |');
    lines.push('|--------|------------|--------|');
    for (const item of buyItems) {
      const pct = ((item.suggestedAmount! / total) * 100).toFixed(0);
      const name = symbolNames.get(item.symbol) || '';
      lines.push(`| ${item.symbol} | ${name ? name + ' ' : ''}${pct}% | $${item.suggestedAmount!.toLocaleString()} |`);
    }
    lines.push('');
    lines.push(`**Total: $${total.toLocaleString()}** across ${buyItems.length} positions`);
    lines.push('');

    // Add rationale section
    const rationales = buyItems
      .map(s => ({ symbol: s.symbol, text: getRationale(s.symbol) }))
      .filter(r => r.text);
    if (rationales.length > 0) {
      lines.push('**Rationale:**');
      for (const r of rationales) {
        lines.push(`- **${r.symbol}**: ${r.text.trim()}`);
      }
    }

    return lines.join('\n');
  }, [tldr, buyItems, total, symbolNames, proseText]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildCopyText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS or permission denied
      const textarea = document.createElement('textarea');
      textarea.value = buildCopyText();
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [buildCopyText]);

  const handleBuy = useCallback((symbol: string, amount: number) => {
    onTrade(symbol, 'BUY', undefined, amount);
  }, [onTrade]);

  return (
    <div className="card-frost" style={{
      marginBottom: '16px',
      padding: '0',
      overflow: 'hidden',
    }}>
      {/* ── Header row: TL;DR + copy button ── */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '14px 16px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#22d3ee',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '4px',
          }}>
            📋 TL;DR
          </div>
          <div style={{
            fontSize: '13px',
            color: '#e2e8f0',
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}>
            {tldr}
          </div>
        </div>
        <button
          onClick={handleCopy}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: copied
              ? 'rgba(34,211,238,0.15)'
              : 'rgba(255,255,255,0.06)',
            border: `1px solid ${copied
              ? 'rgba(34,211,238,0.3)'
              : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '8px',
            color: copied ? '#22d3ee' : '#94a3b8',
            fontSize: '11px',
            fontWeight: 600,
            padding: '6px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '12px' }}>
            {copied ? '✅' : '📋'}
          </span>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* ── Allocation table ── */}
      <div style={{
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12px',
        }}>
          <thead>
            <tr style={{
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <th style={thStyle}>Ticker</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Name</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Allocation</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
              <th style={{ ...thStyle, textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {buyItems.map((item) => {
              const pct = ((item.suggestedAmount! / total) * 100).toFixed(0);
              const name = symbolNames.get(item.symbol) || '';
              // Truncate long names
              const displayName = name.length > 28
                ? name.slice(0, 25) + '…'
                : name;

              return (
                <tr key={item.symbol} style={{
                  borderBottom: '1px solid var(--border-subtle)',
                }}>
                  <td style={{
                    ...tdStyle,
                    fontWeight: 700,
                    color: '#e2e8f0',
                    letterSpacing: '0.03em',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.symbol}
                  </td>
                  <td style={{
                    ...tdStyle,
                    textAlign: 'left',
                    color: '#94a3b8',
                    maxWidth: '140px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {displayName || '—'}
                  </td>
                  <td style={{
                    ...tdStyle,
                    textAlign: 'right',
                    color: '#22d3ee',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>
                    {pct}%
                  </td>
                  <td style={{
                    ...tdStyle,
                    textAlign: 'right',
                    color: '#e2e8f0',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>
                    ${item.suggestedAmount!.toLocaleString()}
                  </td>
                  <td style={{
                    ...tdStyle,
                    textAlign: 'center',
                    padding: '6px 8px',
                  }}>
                    {enabled ? (
                      <button
                        onClick={() => handleBuy(item.symbol, item.suggestedAmount!)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          background: 'rgba(16,185,129,0.12)',
                          border: '1px solid rgba(16,185,129,0.35)',
                          borderRadius: '5px',
                          color: '#10b981',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '3px 8px',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          letterSpacing: '0.03em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        💰 BUY
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{
                padding: '10px 16px',
                fontSize: '11px',
                color: '#64748b',
                textAlign: 'right',
                fontWeight: 600,
              }}>
                Total: <span style={{ color: '#e2e8f0' }}>${total.toLocaleString()}</span> · {buyItems.length} position{buyItems.length !== 1 ? 's' : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: '10px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: '12px',
  verticalAlign: 'middle',
};
