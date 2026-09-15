// ─── POST /api/portfolio/chart ─────────────────────────────
// Weighted portfolio-value series for the account chart.
//
// Body: { positions: [{ symbol, shares, buyDate?, avgCost?, totalCost? }], cashBalance, range }
//
// All of the series maths lives in `lib/portfolio/value-series.ts` (single
// source of truth) so the chat chart resolver and this route can never
// disagree. This handler is now only body parsing + HTTP shape.

import { NextRequest, NextResponse } from 'next/server';
import {
  buildPortfolioValueSeries,
  isChartRange,
  type ChartRange,
  type ValueSeriesPosition,
} from '@/lib/portfolio/value-series';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const positions: ValueSeriesPosition[] = body.positions || [];
    const cashBalance: number = body.cashBalance ?? 0;
    const range: ChartRange = isChartRange(body.range) ? body.range : '1M';

    console.log(`[Chart] Request: ${positions.length} positions, range=${range}, cash=${cashBalance}`);

    if (positions.length === 0) {
      return NextResponse.json({ points: [] });
    }

    const payload = await buildPortfolioValueSeries(positions, cashBalance, range);
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('[Chart API]', error?.message || error);
    return NextResponse.json(
      { points: [], error: 'Failed to fetch chart data' },
      { status: 500 },
    );
  }
}
