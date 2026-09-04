import type { RebalancePlan } from '@/lib/ai/account-actions';
import type { ExportPayload, ExportRow } from './xlsx';

/**
 * Convert a deterministic rebalance plan into the shared export payload.
 * This is the chat AI Advisor "download the rebalance plan" path — the SAME
 * payload shape the read-only-account rebalance download will consume.
 */
export function planToExportPayload(plan: RebalancePlan): ExportPayload {
  const trades = plan.lines.filter(
    (l) => l.symbol && l.symbol.toUpperCase() !== 'CASH' && Math.abs(l.delta) >= 1,
  );

  const rows: ExportRow[] = trades.map((l) => {
    const amountUsd = Math.round(Math.abs(l.delta) * 100) / 100;
    const price =
      l.qty > 0 && l.currentValue > 0
        ? Math.round((l.currentValue / l.qty) * 100) / 100
        : null;
    return {
      ticker: l.symbol.toUpperCase(),
      company: l.name || null,
      action: l.action,
      qty: l.action === 'sell' && l.qty > 0 ? l.qty : null,
      amountUsd,
      price,
      lineTotal: amountUsd,
      note: null,
    };
  });

  const buys = rows.filter((r) => r.action === 'buy').length;
  const sells = rows.filter((r) => r.action === 'sell').length;

  let subtitle: string;
  if (plan.cashOnly) {
    subtitle = `Cash-only deployment — ${buys} buy${buys === 1 ? '' : 's'}, no sells`;
  } else if (plan.customAmount != null) {
    subtitle = `Custom rebalance — deploy $${Math.round(plan.customAmount * 100) / 100} (${buys} buys, no sells)`;
  } else {
    subtitle = `${buys} buy${buys === 1 ? '' : 's'} · ${sells} sell${sells === 1 ? '' : 's'}`;
  }

  return {
    title: `Rebalance Plan — ${plan.styleName}`,
    subtitle,
    thesis: plan.description || null,
    grandTotal: Math.round(plan.totalBuy * 100) / 100,
    rows,
  };
}
