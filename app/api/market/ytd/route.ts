// ─── Year-to-Date Baseline Closes ─────────────────────────────
// GET /api/market/ytd?symbols=AAPL,MSFT,...
// Returns, per symbol, the last close of the PRIOR year (the standard YTD
// baseline) plus the latest close, so callers can compute a year-to-date move.
//
// Market data only — no user data, no auth (same posture as /api/market/quotes).
// Cached in-process for 6 hours; the prior-year close never changes intraday.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface YtdRow {
  yearStartClose: number;
  latestClose: number;
  latestDate: string | null;
  ytdPct: number;
}

interface YtdPayload {
  year: number;
  asOf: string;
  quotes: Record<string, YtdRow>;
  source: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { row: YtdRow | null; ts: number }>();

/** Yahoo rejects dots in class shares (BRK.B → BRK-B). */
function yahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-');
}

async function fetchYtdRow(symbol: string, year: number): Promise<YtdRow | null> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.row;

  const jan1 = Math.floor(Date.UTC(year, 0, 1) / 1000);
  const period1 = jan1 - 20 * 24 * 60 * 60; // start ~3 weeks before the new year
  const period2 = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  let row: YtdRow | null = null;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?period1=${period1}&period2=${period2}&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json: any = await res.json();
      const result = json?.chart?.result?.[0];
      const stamps: number[] = result?.timestamp || [];
      const closesRaw: Array<number | null> = result?.indicators?.quote?.[0]?.close || [];

      let yearStartClose: number | null = null;
      let latestClose: number | null = null;
      let latestDate: string | null = null;

      for (let i = 0; i < stamps.length; i++) {
        const close = closesRaw[i];
        if (typeof close !== 'number' || !Number.isFinite(close)) continue;
        if (stamps[i] < jan1) {
          // Last trading day of the PRIOR year — the YTD baseline.
          yearStartClose = close;
        } else {
          latestClose = close;
          latestDate = new Date(stamps[i] * 1000).toISOString().slice(0, 10);
        }
      }

      if (yearStartClose && latestClose && yearStartClose > 0) {
        row = {
          yearStartClose,
          latestClose,
          latestDate,
          ytdPct: ((latestClose - yearStartClose) / yearStartClose) * 100,
        };
      }
    }
  } catch {
    row = null;
  }

  cache.set(symbol, { row, ts: Date.now() });
  return row;
}

/** Run tasks with a small concurrency cap so we never fan out 25 at once. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('symbols') || '';
  const symbols = [...new Set(
    raw.split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z][A-Z.\-]{0,9}$/.test(s)),
  )].slice(0, 60);

  if (symbols.length === 0) {
    return Response.json({ error: 'symbols query param required' }, { status: 400 });
  }

  const year = new Date().getUTCFullYear();
  const rows = await mapLimited(symbols, 5, sym => fetchYtdRow(sym, year));

  const quotes: Record<string, YtdRow> = {};
  symbols.forEach((sym, i) => {
    if (rows[i]) quotes[sym] = rows[i] as YtdRow;
  });

  const payload: YtdPayload = {
    year,
    asOf: new Date().toISOString(),
    quotes,
    source: 'yahoo',
  };

  return Response.json(payload, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
