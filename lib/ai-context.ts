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

  return `
PORTFOLIO CONTEXT (as of now):
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
