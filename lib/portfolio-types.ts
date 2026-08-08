/** Shared types for PORTFOLIO blocks — used by server-side validation and client-side rendering.
 *
 * Phase 1 extension: adds CASH/reserve positions, explicit side (BUY/SELL),
 * and source metadata for symbol resolution confidence.
 */

export interface PortfolioPosition {
  symbol: string;
  amount: number;
  /** Explicit trade side. Defaults to 'buy' for backward compatibility. */
  side?: 'buy' | 'sell';
  /** If true, this is a CASH/reserve line item — no market symbol, no trade button. */
  isReserve?: boolean;
  /** Source confidence for the symbol (from merged symbol-resolution module). */
  symbolConfidence?: 'high' | 'medium' | 'low';
}

export interface PortfolioBlock {
  total: number;
  strategy?: string;
  positions: PortfolioPosition[];
  raw: string;
  parseError?: string;
}
