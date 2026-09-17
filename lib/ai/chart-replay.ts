/**
 * Client-side helpers for chart replay (pure — no I/O).
 *
 * `buildChartResolvePayload` mirrors the portfolio snapshot the chat request
 * sends, so a retro-resolve sees the same numbers a live ask would — with one
 * deliberate exception: an UNKNOWN cash balance stays `null` (never coerced to
 * 0), so a replayed cash chart cannot show a fabricated $0.
 * `selectChartHealCandidates` picks the messages worth asking about: ones that
 * carry a `[CHART:…]` marker in their STORED content but have no persisted
 * chart payload yet.
 */

export interface ChartResolvePortfolio {
  equity: number;
  /** `null` when the broker did not report cash — NEVER 0 (0 is a real value). */
  cash: number | null;
  positions: Array<Record<string, any>>;
}

/** The exact portfolio payload shape `app/api/chat` expects (server reuses it for ctx). */
export function buildChartResolvePayload(liveAccount: any): ChartResolvePortfolio | null {
  if (!liveAccount) return null;
  return {
    equity: liveAccount.equity ?? 0,
    // Unknown cash must stay unknown: `cashKnown` in buildChartCtx keys off a
    // numeric value, so `null` correctly yields an unknown-cash ctx.
    cash: typeof liveAccount.cash === 'number' && Number.isFinite(liveAccount.cash)
      ? liveAccount.cash
      : null,
    positions: (liveAccount.positions || []).map((p: any) => ({
      symbol: p.symbol,
      name: p.name || p.symbol,
      sector: p.sector || null,
      qty: p.qty || 0,
      price: p.price ?? p.avgCost ?? 0,
      marketValue: p.marketValue || 0,
      avgCost: p.avgCost,
      unrealizedPnl: p.totalPnl,
      buyDate: p.buyDate,
      type: p.type,
    })),
  };
}

export interface ChartHealCandidate {
  id: string;
  content: string;
}

/**
 * Which stored messages still need a chart re-resolve?
 * Only AI messages with a DB id (an id is required to persist the heal),
 * a `[CHART:` marker in the raw stored content, and no charts already attached.
 * Newest first, capped — a replay path must never become a batch job.
 */
export function selectChartHealCandidates(
  messages: Array<{ id?: string; role?: string; content?: string; charts?: unknown[] | null }>,
  max = 8,
): ChartHealCandidate[] {
  const out: ChartHealCandidate[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (out.length >= max) break;
    const m = messages[i];
    if (!m || m.role !== 'ai') continue;
    if (!m.id) continue;
    if (Array.isArray(m.charts) && m.charts.length > 0) continue;
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content.includes('[CHART:')) continue;
    out.push({ id: m.id, content });
  }
  return out;
}
