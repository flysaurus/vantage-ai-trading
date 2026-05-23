/**
 * Zod schemas for AI-generated structured outputs.
 * Used to validate and type AI responses before they reach the UI.
 */
import { z } from 'zod';

// ─── Trade Signal ───
export const TradeSignalSchema = z.object({
  symbol: z.string().min(1).max(5),
  action: z.enum(['buy', 'sell', 'hold']),
  conviction: z.number().min(0).max(100),
  entryPrice: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  reason: z.string().min(1),
  risks: z.array(z.string()).optional().default([]),
});

export type TradeSignal = z.infer<typeof TradeSignalSchema>;

// ─── Risk Analysis ───
export const RiskFactorSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  explanation: z.string(),
  weight: z.number().min(0).max(1),
});

export const RiskAnalysisSchema = z.object({
  overallRisk: z.number().min(0).max(100),
  factors: z.array(RiskFactorSchema),
  warnings: z.array(z.string()).optional().default([]),
  suggestions: z.array(z.string()).optional().default([]),
});

export type RiskAnalysis = z.infer<typeof RiskAnalysisSchema>;

// ─── Rebalance Plan ───
export const RebalanceTradeSchema = z.object({
  symbol: z.string().min(1).max(5),
  action: z.enum(['buy', 'sell', 'trim', 'add']),
  qty: z.number().optional(),
  dollarAmount: z.number().optional(),
  reason: z.string(),
});

export const RebalancePlanSchema = z.object({
  trades: z.array(RebalanceTradeSchema),
  summary: z.string().optional(),
});

export type RebalancePlan = z.infer<typeof RebalancePlanSchema>;

// ─── Market Insight ───
export const MarketInsightSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
  affectedPositions: z.array(z.string()).optional().default([]),
});

export type MarketInsight = z.infer<typeof MarketInsightSchema>;

// ─── Structured Output Union ───
export const StructuredCardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trade_signal'), data: TradeSignalSchema }),
  z.object({ type: z.literal('risk_analysis'), data: RiskAnalysisSchema }),
  z.object({ type: z.literal('rebalance_plan'), data: RebalancePlanSchema }),
  z.object({ type: z.literal('market_insight'), data: MarketInsightSchema }),
]);

export type StructuredCard = z.infer<typeof StructuredCardSchema>;

/**
 * Attempts to extract and parse structured JSON blocks from AI response text.
 * Looks for ```json ... ``` fenced code blocks.
 */
export function extractStructuredCards(text: string): StructuredCard[] {
  const cards: StructuredCard[] = [];
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      // Handle both single object and array
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const result = StructuredCardSchema.safeParse(item);
        if (result.success) {
          cards.push(result.data);
        }
      }
    } catch {
      // Skip unparseable JSON blocks
    }
  }

  return cards;
}

/**
 * Maps a StructuredCard to the AICardComponent format used by the UI.
 */
export function structuredCardToComponent(
  card: StructuredCard
): { type: string; symbol?: string; title: string; conviction?: number; reason?: string; price?: number; metrics?: Record<string, number | string>; actions?: Array<{ label: string; action: string; params?: Record<string, string | number> }> } {
  switch (card.type) {
    case 'trade_signal': {
      const d = card.data;
      const isBuy = d.action === 'buy';
      return {
        type: isBuy ? 'buy_signal' : 'sell_signal',
        symbol: d.symbol,
        title: isBuy ? `${d.conviction}% Conviction Buy` : `${d.conviction}% Conviction Sell`,
        conviction: d.conviction,
        reason: d.reason,
        price: d.entryPrice,
        metrics: d.stopLoss || d.takeProfit
          ? { stopLoss: d.stopLoss || 0, takeProfit: d.takeProfit || 0 }
          : undefined,
        actions: [
          { label: isBuy ? 'Buy' : 'Sell', action: isBuy ? 'buy' : 'sell', params: { symbol: d.symbol } },
          { label: 'Details', action: 'details' },
        ],
      };
    }
    case 'risk_analysis': {
      const d = card.data;
      return {
        type: 'risk_analysis',
        title: `Risk Score: ${d.overallRisk}/100`,
        conviction: d.overallRisk,
        reason: d.factors.map((f: { name: string; score: number; explanation: string }) => `${f.name}: ${f.score}/100`).join(' • '),
        metrics: Object.fromEntries(d.factors.map((f: { name: string; score: number }) => [f.name, f.score])),
        actions: [{ label: 'View Details', action: 'details' }],
      };
    }
    case 'rebalance_plan':
      return {
        type: 'rebalance',
        title: 'Rebalance Plan',
        reason: card.data.trades.map((t: { symbol: string; action: string; reason: string }) => `${t.symbol}: ${t.action} — ${t.reason}`).join('\n'),
        actions: [{ label: 'Execute Plan', action: 'rebalance' }],
      };
    case 'market_insight':
      return {
        type: 'insight',
        title: card.data.headline,
        reason: card.data.summary,
        actions: [{ label: 'Explore', action: 'details' }],
      };
  }
}
