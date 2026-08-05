/** Shared types for PORTFOLIO blocks — used by both server-side validation and client-side rendering. */

export interface PortfolioPosition {
  symbol: string;
  amount: number;
}

export interface PortfolioBlock {
  total: number;
  strategy?: string;
  positions: PortfolioPosition[];
  raw: string;
  parseError?: string;
}
