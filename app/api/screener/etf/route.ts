// ─── POST /api/screener/etf ───────────────────────────────────
// ETF screener with fund-appropriate filters (category/sector focus,
// expense-ratio ceiling, AUM floor, yield, trailing 1y/3y/5y returns,
// index tracked). Built on the Finnhub /etf/list universe + Yahoo
// fundProfile/fundPerformance enrichment (see lib/etf-screener.ts).
//
// Unlike the stock screener, every result carries a live expense ratio
// and trailing returns so recommendations never fall back to memory.

import { NextRequest, NextResponse } from 'next/server';
import { screenEtfs, extractEtfCriteria } from '@/lib/etf-screener';
import type { EtfScreenerCriteria } from '@/lib/etf-screener';

export interface EtfScreenerRequest {
  // Natural-language query (optional) — criteria are extracted from it
  query?: string;
  // Or explicit criteria (overrides/merges with query extraction)
  categories?: string[];
  category?: string;           // convenience alias for a single category
  expenseRatioMax?: number;
  aumMin?: number;
  yieldMin?: number;
  return1yMin?: number;
  return3yMin?: number;
  return5yMin?: number;
  indexTracked?: string;
  maxScan?: number;
  limit?: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: EtfScreenerRequest = await req.json().catch(() => ({}));

    const extracted = body.query ? extractEtfCriteria(body.query) : ({
      categories: [] as string[],
      expenseRatioMax: null,
      aumMin: null,
      yieldMin: null,
      return1yMin: null,
      return3yMin: null,
      return5yMin: null,
      indexTracked: null,
    } satisfies EtfScreenerCriteria);

    const criteria: EtfScreenerCriteria = {
      categories: body.categories ?? (body.category ? [body.category] : extracted.categories),
      expenseRatioMax: body.expenseRatioMax ?? extracted.expenseRatioMax,
      aumMin: body.aumMin ?? extracted.aumMin,
      yieldMin: body.yieldMin ?? extracted.yieldMin,
      return1yMin: body.return1yMin ?? extracted.return1yMin,
      return3yMin: body.return3yMin ?? extracted.return3yMin,
      return5yMin: body.return5yMin ?? extracted.return5yMin,
      indexTracked: body.indexTracked ?? extracted.indexTracked,
    };

    const output = await screenEtfs(criteria, {
      maxScan: body.maxScan ?? 24,
      limit: body.limit ?? 20,
    });

    return NextResponse.json({ ...output, criteria });
  } catch (err: any) {
    console.error('[screener/etf] error:', err.message);
    return NextResponse.json(
      { error: 'ETF screener failed', results: [], scanned: 0, total: 0, universe: 0 },
      { status: 200 },
    );
  }
}
