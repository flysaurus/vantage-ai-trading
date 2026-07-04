// GET /api/company/profile?symbol=BRK.B
// Returns shortName/longName from Yahoo Finance (server-side, bypasses CORS).
// Used by hydrateNames() in PortfolioTab to backfill real company names.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getCompanyProfile } from '@/lib/market-data';

const cache = new Map<string, { data: { name: string; ticker: string; sector: string }; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();

  if (!symbol || !/^[A-Za-z.]{1,10}$/.test(symbol)) {
    return Response.json({ error: 'Valid symbol required' }, { status: 400 });
  }

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json(cached.data, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  try {
    const profile = await getCompanyProfile(symbol);
    if (!profile || !profile.name) {
      return Response.json({ name: symbol, ticker: symbol, sector: '' }, { status: 200 });
    }

    const data = { name: profile.name, ticker: profile.ticker || symbol, sector: profile.industry || '' };
    cache.set(symbol, { data, ts: Date.now() });

    return Response.json(data, {
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return Response.json({ name: symbol, ticker: symbol }, { status: 200 });
  }
}
