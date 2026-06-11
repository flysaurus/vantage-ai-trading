import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_KEY = process.env.FINNHUB_IO_API_KEY;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

type Range = '1D' | '1W' | '1M' | 'YTD' | 'ALL';

interface PositionInput {
  symbol: string;
  shares: number;
  buyDate?: string;
  avgCost?: number;
  totalCost?: number;
}

interface CandleResult {
  timestamps: number[];
  map: Record<number, number>;
}

// ─── Range params ──────────────────────────────────────

function getRangeParams(range: Range) {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date();

  switch (range) {
    case '1D': {
      const open = new Date();
      open.setHours(9, 30, 0, 0);
      return {
        from: Math.floor(open.getTime() / 1000),
        to: now,
        resolution: '5',
      };
    }
    case '1W':
      return {
        from: now - 7 * 86400,
        to: now,
        resolution: '60',
      };
    case '1M':
      return {
        from: now - 30 * 86400,
        to: now,
        resolution: 'D',
      };
    case 'YTD': {
      const jan1 = new Date(today.getFullYear(), 0, 1);
      return {
        from: Math.floor(jan1.getTime() / 1000),
        to: now,
        resolution: 'D',
      };
    }
    case 'ALL':
      return {
        from: Math.floor(new Date('2024-01-08').getTime() / 1000),
        to: now,
        resolution: 'W',
      };
  }
}

// ─── Fetch Finnhub candles ──────────────────────────────

async function fetchCandles(
  symbol: string,
  from: number,
  to: number,
  resolution: string,
): Promise<CandleResult | null> {
  const url =
    `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_KEY}`;

  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    const data = await res.json();

    if (data.s !== 'ok' || !data.t || !data.c) return null;

    const map: Record<number, number> = {};
    data.t.forEach((t: number, i: number) => {
      map[t] = data.c[i];
    });

    return { timestamps: data.t, map };
  } catch {
    return null;
  }
}

// ─── POST handler ───────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const positions: PositionInput[] = body.positions || [];
    const cashBalance: number = body.cashBalance ?? 0;
    const range: Range = body.range || '1M';

    if (positions.length === 0) {
      return NextResponse.json({ points: [] });
    }

    const { from, to, resolution } = getRangeParams(range);

    // Fetch candles for all symbols in parallel
    const candleResults = await Promise.allSettled(
      positions.map((p) =>
        fetchCandles(p.symbol, from, to, resolution),
      ),
    );

    // Get reference timestamps from first successful result
    let refTimestamps: number[] = [];
    for (const result of candleResults) {
      if (result.status === 'fulfilled' && result.value) {
        refTimestamps = result.value.timestamps;
        break;
      }
    }

    if (refTimestamps.length === 0) {
      // No candles at all — return empty with a hint
      return NextResponse.json({ points: [], error: 'No candle data available' });
    }

    // Build candle maps keyed by symbol
    const candleMaps: Record<string, Record<number, number>> = {};
    candleResults.forEach((result, i) => {
      const sym = positions[i].symbol;
      if (result.status === 'fulfilled' && result.value) {
        candleMaps[sym] = result.value.map;
      } else {
        candleMaps[sym] = {};
      }
    });

    // Calculate portfolio value at each reference timestamp
    const points = refTimestamps.map((t) => {
      let value = cashBalance;

      for (const pos of positions) {
        const buyTime = pos.buyDate
          ? Math.floor(new Date(pos.buyDate).getTime() / 1000)
          : 0;

        if (t < buyTime) {
          // Position didn't exist yet — add back its cost as cash
          value += pos.totalCost ?? (pos.shares * (pos.avgCost ?? 0));
        } else {
          const price = candleMaps[pos.symbol]?.[t];
          if (typeof price === 'number') {
            value += pos.shares * price;
          } else {
            // Missing candle — use avgCost as fallback
            value += pos.shares * (pos.avgCost ?? 0);
          }
        }
      }

      return { timestamp: t, value: Math.round(value * 100) / 100 };
    });

    return NextResponse.json({ points });
  } catch (error: any) {
    console.error('[Chart API]', error?.message || error);
    return NextResponse.json(
      { points: [], error: 'Failed to fetch chart data' },
      { status: 500 },
    );
  }
}
