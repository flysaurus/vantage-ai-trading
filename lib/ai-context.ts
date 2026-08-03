interface Position {
  symbol: string
  name: string
  qty: number
  currentPrice: number
  avgCost: number
  marketValue: number
  totalPnl: number
  totalPnlPct: number
  todayChange: number
  todayChangePct: number
  pctOfAccount: number
  sector: string
}

interface PortfolioContext {
  totalValue: number
  todayPnl: number
  todayPnlPct: number
  totalPnl: number
  totalPnlPct: number
  buyingPower: number
  cash: number
  investorStyle: string
  riskTolerance: string
  holdingsUnavailable?: boolean
  positions: Position[]
}

export function buildPortfolioContext(portfolio: PortfolioContext): string {
  const positionsSummary = portfolio.positions
    .map(p =>
      `${p.symbol} (${p.name}): ${p.qty} shares @ $${p.currentPrice.toFixed(2)} | ` +
      `Value: $${p.marketValue.toFixed(0)} (${p.pctOfAccount.toFixed(1)}% of portfolio) | ` +
      `Total P&L: ${p.totalPnl >= 0 ? '+' : ''}$${p.totalPnl.toFixed(0)} (${p.totalPnlPct.toFixed(1)}%) | ` +
      `Today: ${p.todayChange >= 0 ? '+' : ''}$${p.todayChange.toFixed(0)} (${p.todayChangePct.toFixed(1)}%) | ` +
      `Avg Cost: $${p.avgCost.toFixed(2)} | Sector: ${p.sector}`
    )
    .join('\n')

  const priceAnchor = portfolio.positions
    .map(p => `${p.symbol}: $${p.currentPrice.toFixed(2)} (as of now)`)
    .join(' | ')

  const holdingsWarning = portfolio.holdingsUnavailable
    ? '⚠️ NOTE: Holdings data is NOT available for this account (broker restriction). Positions shown may be incomplete or empty. Do NOT make recommendations based on current position data.'
    : '';

  return `
⚠️ CURRENT MARKET PRICES (use these, ignore training data):
${priceAnchor}

${holdingsWarning}PORTFOLIO CONTEXT (as of now):
Total Value: $${portfolio.totalValue.toLocaleString()}
Today P&L: ${portfolio.todayPnl >= 0 ? '+' : ''}$${Math.abs(portfolio.todayPnl).toFixed(0)} (${portfolio.todayPnlPct.toFixed(1)}%)
Total P&L: ${portfolio.totalPnl >= 0 ? '+' : ''}$${Math.abs(portfolio.totalPnl).toFixed(0)} (${portfolio.totalPnlPct.toFixed(1)}%)
Buying Power: $${portfolio.buyingPower.toLocaleString()}
Cash: $${portfolio.cash.toLocaleString()}
Investor Style: ${portfolio.investorStyle}
Risk Tolerance: ${portfolio.riskTolerance}

POSITIONS (${portfolio.positions.length} holdings):
${positionsSummary}
`
}
