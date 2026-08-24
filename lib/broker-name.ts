/**
 * Broker display name — single source of truth.
 *
 * Every SnapTrade-connected broker is rendered as:
 *     "SnapTrade - {exact broker name}"
 * e.g. "SnapTrade - Alpaca Paper", "SnapTrade - Robinhood".
 *
 * The broker name is the exact, human-friendly name SnapTrade assigns (its
 * account/brokerage name) — NOT a slug-mangled string. Unknown slugs fall back
 * to a title-case cleanup of the slug (never raw "ALPACA-PAPER").
 *
 * This file replaces six near-identical `formatBrokerName` copies that had
 * drifted across route files (split on '_' vs '-', different casing rules).
 */

const SNAPTRADE_SLUG_NAMES: Record<string, string> = {
  'ALPACA-PAPER': 'Alpaca Paper',
  'ALPACA': 'Alpaca',
  'ROBINHOOD': 'Robinhood',
  'SCHWAB': 'Charles Schwab',
  'FIDELITY': 'Fidelity',
  'VANGUARD': 'Vanguard',
  'ETRADE': 'E*TRADE',
  'TDAMERITRADE': 'TD Ameritrade',
  'WEBULL': 'Webull',
  'COINBASE': 'Coinbase',
  'INTERACTIVEBROKERS': 'Interactive Brokers',
  'TASTYTRADE': 'tastytrade',
  'TRADESTATION': 'TradeStation',
  'ALLY': 'Ally Invest',
};

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function formatBrokerName(slug: string | null | undefined): string {
  if (!slug) return 'SnapTrade';
  const key = slug.toUpperCase();
  const friendly = SNAPTRADE_SLUG_NAMES[key] ?? titleCaseSlug(slug);
  return `SnapTrade - ${friendly}`;
}
