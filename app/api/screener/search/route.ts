// ─── POST /api/screener/search ────────────────────────────────
// Stock screener using Finnhub profile2 + metric (both free tier).
// Scans a curated universe of top US stocks/ETFs against user filters.
//
// Finnhub free tier: 60 calls/min. We pace at ~1 call/sec (batchSize=2
// every 2200ms) to stay safely under the limit. Max 40 profiles per request
// (~44s) — the curated list puts sector-matching candidates first so even
// if we don't scan all 400+, the most relevant stocks are profiled first.

import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

// ─── Curated US stock universe ────────────────────────────────
// S&P 500 constituents, Nasdaq 100, major ETFs. Grouped by sector so
// we can smart-order: sector-matching stocks profiled first.
const SECTOR_STOCKS: Record<string, string[]> = {
  technology: [
    'AAPL','MSFT','NVDA','AVGO','ORCL','ADBE','CRM','CSCO','AMD','QCOM',
    'TXN','IBM','NOW','INTU','UBER','ABNB','SNOW','PLTR','SQ','SHOP',
    'NET','DDOG','CRWD','ZS','PANW','FTNT','OKTA','MDB','SNPS','CDNS',
    'WDAY','ADSK','TEAM','ZM','AMAT','ADI','ANET','ANSS','AKAM','DELL',
    'FICO','FFIV','GEN','HPQ','HPE','JNPR','KEYS','KLAC','LRCX','MCHP',
    'MPWR','MSI','MU','NTAP','NXPI','ON','QRVO','SMCI','STX','SWKS',
    'TEL','TER','TYL','VRSN','ZBRA',
  ],
  'financial services': [
    'JPM','BAC','WFC','C','GS','MS','BLK','SCHW','AXP','V','MA',
    'PYPL','COF','USB','PNC','TFC','BK','STT','AMP','DFS','ALLY',
    'SOFI','HOOD','ICE','CME','MCO','SPGI','AIG','MET','PRU','TRV',
    'ALL','PGR','CB','AFL','MKTX','FIS','FISV','GPN','TROW','NTRS',
    'BX','KKR','APO','ARES','BEN','IVZ','NDAQ','RJF','SYF','CFG',
    'HBAN','KEY','MTB','RF','ZION','FITB',
  ],
  healthcare: [
    'JNJ','UNH','PFE','MRK','ABBV','ABT','TMO','DHR','LLY','BMY',
    'AMGN','GILD','ISRG','REGN','VRTX','BIIB','ZTS','CVS','CI','HUM',
    'ELV','CNC','MRNA','DXCM','IDXX','IQV','A','WAT','MTD','ILMN',
    'BSX','BAX','BDX','CAH','DGX','GEHC','HCA','HOLX','HSIC','INCY',
    'LH','MCK','MOH','PODD','RMD','SOLV','STE','SYK','TECH','TFX',
    'UHS','WST','ZBH','EW','RPRX','VTRS','CTLT',
  ],
  consumer: [
    'AMZN','WMT','COST','HD','MCD','NKE','LOW','SBUX','TGT','TJX',
    'ROST','DG','DLTR','ORLY','AZO','ULTA','LULU','DHI','LEN','PHM',
    'BKNG','MAR','HLT','CMG','YUM','DPZ','MELI','EBAY','ETSY','W',
    'TSLA','F','GM','RCL','CCL','NCLH','DAL','UAL','LUV','EXPE',
    'BBY','KMX','DRI','DPZ','YUM','MGM','WYNN','LKQ','POOL','TPR',
    'EL','HAS','LEG','MHK','NVR','RL','TAP','VFC','WHR',
  ],
  industrials: [
    'CAT','DE','GE','BA','LMT','RTX','HON','UPS','FDX','UNP',
    'CSX','NSC','ITW','EMR','ROK','PH','ETN','CMI','PCAR','DOV',
    'ADP','PAYX','CPRT','FAST','GWW','IR','OTIS','AME','AXON','CARR',
    'DAL','DOV','EFX','GNRC','HII','HUBB','HWM','IEX','ITT','JBHT',
    'JCI','LHX','MMM','NDSN','PNR','PWR','RSG','SWK','TDG','TT',
    'TXT','URI','VLTO','WAB','WM','XYL',
  ],
  energy: [
    'XOM','CVX','COP','EOG','SLB','PSX','MPC','VLO','OXY','HES',
    'APA','BKR','CTRA','DVN','EQT','FANG','HAL','KMI','MRO','OKE',
    'PXD','TRGP','VST','WMB','XOM','APA',
  ],
  utilities: [
    'NEE','DUK','SO','D','AEP','EXC','SRE','XEL','ED','PEG',
    'AES','ATO','CMS','CNP','DTE','DUK','EIX','ES','ETR','EVRG',
    'FE','LNT','NI','NRG','PCG','PNW','PPL','WEC',
  ],
  'real estate': [
    'AMT','PLD','EQIX','CCI','SPG','PSA','O','WELL','AVB','EQR',
    'ARE','BXP','CPT','DLR','ESS','EXR','FRT','HST','INVH','IRM',
    'KIM','MAA','PEAK','REG','SBAC','UDR','VICI','VNO','VTR','WY',
  ],
  materials: [
    'LIN','APD','ECL','SHW','FCX','NEM','DOW','DD','NUE','STLD',
    'ALB','BALL','CE','CF','CLF','CTVA','EMN','FMC','IFF','IP',
    'MLM','MOS','PKG','PPG','RPM','VMC','WRK',
  ],
  'media & entertainment': [
    'DIS','NFLX','CMCSA','VZ','T','TMUS','CHTR','WBD','PARA','LYV',
    'EA','FOX','FOXA','IPG','LYV','MTCH','NWL','OMC','TTWO','WBD',
  ],
  etf: [
    'SPY','QQQ','IWM','DIA','XLF','XLK','XLE','XLV','XLI','XLY',
    'XLU','XLP','XLB','XLC','XLRE','VTI','VOO','VT','BND','AGG',
    'GLD','SLV','USO','UNG','TLT','HYG','LQD','ARKK','SOXX','SMH',
    'IWF','IWB','IWD','IVE','IJH','IJR','IYR','VNQ','XLG','RSP',
    'TQQQ','SQQQ','UCO','SCO','EWZ','FXI','EEM','EFA','VWO',
  ],
};

// Build flat list: sector-matching groups first, rest after
function buildUniverse(sector?: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  // If a sector is specified, put those stocks FIRST so they get profiled
  // before Finnhub rate limits kick in
  const sectorOrder = Object.keys(SECTOR_STOCKS);
  if (sector) {
    const sl = sector.toLowerCase();
    // Move matching sector to front
    const idx = sectorOrder.findIndex(s => s.includes(sl) || sl.includes(s));
    if (idx >= 0) {
      sectorOrder.splice(idx, 1);
      sectorOrder.unshift(Object.keys(SECTOR_STOCKS)[idx]);
    }
  }

  for (const sectorKey of sectorOrder) {
    for (const sym of SECTOR_STOCKS[sectorKey] || []) {
      if (!seen.has(sym)) {
        seen.add(sym);
        ordered.push(sym);
      }
    }
  }
  return ordered;
}

export interface ScreenerFilters {
  marketCap?: 'micro' | 'small' | 'mid' | 'large' | 'mega';
  peMin?: number;
  peMax?: number;
  dividendYieldMin?: number;
  dividendYieldMax?: number;
  sector?: string;
  priceMin?: number;
  priceMax?: number;
  week52ChangeMin?: number;
  week52ChangeMax?: number;
  exchange?: string;
}

export interface ScreenerResult {
  symbol: string;
  name: string;
  price: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  sector: string;
  week52High: number | null;
  week52Low: number | null;
  week52Change: number | null;
  exchange: string;
}

// ─── Market cap ranges ────────────────────────────────────────
const MARKET_CAP_RANGES: Record<string, [number, number]> = {
  micro: [0, 300e6],
  small: [300e6, 2e9],
  mid: [2e9, 10e9],
  large: [10e9, 200e9],
  mega: [200e9, Infinity],
};

// ─── Sector mapping: user labels → Finnhub industry substrings ─
const SECTOR_KEYWORDS: Record<string, string[]> = {
  'technology': ['Technology', 'Software', 'Semiconductor', 'IT', 'Internet', 'Cloud'],
  'financial services': ['Financial', 'Bank', 'Insurance', 'Capital Market', 'Asset Management', 'Diversified Financial', 'Mortgage', 'REIT'],
  'healthcare': ['Healthcare', 'Pharma', 'Biotech', 'Medical', 'Hospital', 'Health'],
  'consumer': ['Consumer', 'Retail', 'Apparel', 'Auto', 'Food', 'Beverage', 'Tobacco', 'Household', 'Personal', 'Restaurant', 'Hotel', 'Leisure', 'Entertainment', 'Travel'],
  'industrials': ['Industrial', 'Aerospace', 'Defense', 'Machinery', 'Construction', 'Engineering', 'Transport', 'Logistics', 'Railroad', 'Trucking', 'Airline'],
  'energy': ['Energy', 'Oil', 'Gas', 'Petroleum', 'Mining', 'Coal'],
  'utilities': ['Utility', 'Electric', 'Water', 'Power'],
  'real estate': ['Real Estate', 'REIT'],
  'materials': ['Material', 'Chemical', 'Metal', 'Steel', 'Paper', 'Packaging'],
  'media & entertainment': ['Media', 'Entertainment', 'Telecom', 'Communication', 'Publishing', 'Broadcasting', 'Gaming'],
  'etf': ['Exchange Traded Fund', 'ETF'],
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = getToken();
  if (!token) {
    return NextResponse.json({ error: 'Finnhub not configured', status: 503 }, { status: 200 });
  }

  try {
    const filters: ScreenerFilters = await req.json().catch(() => ({}));

    // Smart-order: put sector-matching stocks first
    const symbols = buildUniverse(filters.sector);
    console.log(`[screener] Universe: ${symbols.length} stocks (sector: ${filters.sector || 'all'})`);

    // ─── 1. Fetch profiles with rate-limited batching ──────────
    // Finnhub free tier: 60 calls/min but tolerates burst (old code made
    // 50 calls/sec and still got 58 profiles before blocking). Strategy:
    // 3 parallel + 1.5s delay = ~2 calls/sec burst, 44 total ≈ ~44/min.
    // 30 profiles in ~15s. Well within Vercel's 55s maxDuration.
    const MAX_PROFILES = 30;
    const batchSize = 3;
    const batchDelayMs = 1500;
    const profiles: any[] = [];

    const toScan = symbols.slice(0, MAX_PROFILES);
    const { getCompanyProfile: screenerProfile } = await import('@/lib/market-data');

    for (let i = 0; i < toScan.length; i += batchSize) {
      const batch = toScan.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(sym => screenerProfile(sym))
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value?.ticker) {
          profiles.push(r.value);
        }
      }
      // Pace to stay under rate limit
      if (i + batchSize < toScan.length) {
        await new Promise(r => setTimeout(r, batchDelayMs));
      }
    }

    console.log(`[screener] Got ${profiles.length} profiles from ${toScan.length} scanned`);

    // ─── 2. Apply sector + market cap filters ─────────────────
    const sectorFilter = filters.sector?.toLowerCase();
    let keywords: string[] | null = null;
    if (sectorFilter) {
      for (const [key, kws] of Object.entries(SECTOR_KEYWORDS)) {
        if (key.includes(sectorFilter) || sectorFilter.includes(key)) {
          keywords = kws;
          break;
        }
      }
      if (!keywords) keywords = [filters.sector!];
    }

    const results: ScreenerResult[] = [];

    for (const p of profiles) {
      const symbol = p.ticker || '';
      const name = p.name || '';
      const marketCap = p.marketCapitalization != null ? p.marketCapitalization * 1e6 : null;
      const industry = p.industry || p.finnhubIndustry || '';
      const exchange = p.exchange || '';

      // Sector filter: match against keyword list
      if (keywords) {
        const industryLower = industry.toLowerCase();
        const nameLower = name.toLowerCase();
        const matched = keywords.some(kw => {
          const kwl = kw.toLowerCase();
          return industryLower.includes(kwl) || nameLower.includes(kwl);
        });
        if (!matched) continue;
      }

      // Market cap filter
      if (filters.marketCap && marketCap != null) {
        const [lo, hi] = MARKET_CAP_RANGES[filters.marketCap] || [0, Infinity];
        if (marketCap < lo || marketCap > hi) continue;
      }

      results.push({
        symbol,
        name: name || symbol,
        price: null,
        peRatio: null,
        dividendYield: null,
        marketCap,
        sector: industry || 'Unknown',
        week52High: null,
        week52Low: null,
        week52Change: null,
        exchange,
      });
    }

    console.log(`[screener] After filters: ${results.length} matches`);

    // ─── 3. Enrich with metrics (PE, div yield, 52wk, price) ─
    const { getFundamentals: screenerFundamentals, getQuote: screenerQuote } = await import('@/lib/market-data');
    const MAX_ENRICH = 15;
    const topResults = results.slice(0, MAX_ENRICH);
    for (let i = 0; i < topResults.length; i += 3) {
      const batch = topResults.slice(i, i + 3);
      const metricResults = await Promise.allSettled(
        batch.map(r => screenerFundamentals(r.symbol))
      );
      for (let j = 0; j < batch.length; j++) {
        const mr = metricResults[j];
        if (mr.status !== 'fulfilled' || !mr.value) continue;
        const m = mr.value;
        if (m.pe != null) batch[j].peRatio = m.pe;
        if (m.dividendYield != null) batch[j].dividendYield = m.dividendYield;
        if (m.high52w != null) batch[j].week52High = m.high52w;
        if (m.low52w != null) batch[j].week52Low = m.low52w;
        if (batch[j].week52High && batch[j].week52Low) {
          const mid = (batch[j].week52High! + batch[j].week52Low!) / 2;
          batch[j].week52Change = ((batch[j].week52High! - mid) / mid) * 100;
        }
      }
      if (i + 3 < topResults.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // ─── 4. Apply numeric filters on enriched results ─────────
    let final = results;
    if (filters.peMin != null) final = final.filter(s => s.peRatio != null && s.peRatio >= filters.peMin!);
    if (filters.peMax != null) final = final.filter(s => s.peRatio != null && s.peRatio <= filters.peMax!);
    if (filters.dividendYieldMin != null) final = final.filter(s => s.dividendYield != null && s.dividendYield >= filters.dividendYieldMin!);
    if (filters.dividendYieldMax != null) final = final.filter(s => s.dividendYield != null && s.dividendYield <= filters.dividendYieldMax!);

    // Sort by market cap descending
    final.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));

    return NextResponse.json({
      results: final.slice(0, 50),
      total: final.length,
      scanned: profiles.length,
    });
  } catch (err: any) {
    console.error('[screener] error:', err.message);
    return NextResponse.json({ error: 'Screener failed', results: [], total: 0, scanned: 0 }, { status: 200 });
  }
}
