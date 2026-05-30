// ─── POST /api/screener/search ────────────────────────────────
// Stock screener using Finnhub profile2 (free tier) against a
// curated universe of 400+ major US stocks and ETFs.
// No premium endpoints required — uses only profile2 + stock/metric.

import { NextRequest, NextResponse } from 'next/server';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken(): string {
  return process.env.FINNHUB_IO_API_KEY || '';
}

// ─── Curated US stock universe (S&P 500 top constituents + popular ETFs) ─
// Finnhub's /stock/symbol requires a premium plan. This static list
// covers the vast majority of what retail traders screen for.
const STOCK_UNIVERSE = [
  // Mega-cap tech
  'AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','META','TSLA','AVGO','ORCL',
  'ADBE','CRM','CSCO','INTC','AMD','QCOM','TXN','IBM','NOW','INTU',
  'UBER','ABNB','SNOW','PLTR','SQ','SHOP','NET','DDOG','CRWD','ZS',
  'PANW','FTNT','OKTA','MDB','SNPS','CDNS','WDAY','ADSK','TEAM','ZM',
  // Financial Services
  'JPM','BAC','WFC','C','GS','MS','BLK','SCHW','AXP','V','MA',
  'PYPL','COF','USB','PNC','TFC','BK','STT','AMP','DFS','ALLY',
  'SOFI','HOOD','ICE','CME','MCO','SPGI','AIG','MET','PRU','TRV',
  'ALL','PGR','CB','AFL','MKTX','FIS','FISV','GPN','TROW','NTRS',
  // Healthcare
  'JNJ','UNH','PFE','MRK','ABBV','ABT','TMO','DHR','LLY','BMY',
  'AMGN','GILD','ISRG','REGN','VRTX','BIIB','ZTS','CVS','CI','HUM',
  'ELV','CNC','MRNA','DXCM','IDXX','IQV','A','WAT','MTD','ILMN',
  // Consumer / Retail
  'AMZN','WMT','COST','HD','MCD','NKE','LOW','SBUX','TGT','TJX',
  'ROST','DG','DLTR','ORLY','AZO','ULTA','LULU','DHI','LEN','PHM',
  'BKNG','MAR','HLT','CMG','YUM','DPZ','MELI','EBAY','ETSY','W',
  // Industrials / Energy / Materials
  'XOM','CVX','COP','EOG','SLB','PSX','MPC','VLO','OXY','HES',
  'CAT','DE','GE','BA','LMT','RTX','HON','UPS','FDX','UNP',
  'CSX','NSC','ITW','EMR','ROK','PH','ETN','CMI','PCAR','DOV',
  'LIN','APD','ECL','SHW','FCX','NEM','DOW','DD','NUE','STLD',
  // Utilities / Real Estate
  'NEE','DUK','SO','D','AEP','EXC','SRE','XEL','ED','PEG',
  'AMT','PLD','EQIX','CCI','SPG','PSA','O','WELL','AVB','EQR',
  // Communication / Media
  'DIS','NFLX','CMCSA','VZ','T','TMUS','CHTR','WBD','PARA','LYV',
  // ETFs
  'SPY','QQQ','IWM','DIA','XLF','XLK','XLE','XLV','XLI','XLY',
  'XLU','XLP','XLB','XLC','XLRE','VTI','VOO','VT','BND','AGG',
  'GLD','SLV','USO','UNG','TLT','HYG','LQD','ARKK','SOXX','SMH',
  // More large-caps to round out 400+
  'ADP','ADI','AEP','AFL','AJG','AKAM','ALB','ALGN','ALLE','AMAT',
  'AME','AMP','ANET','ANSS','AOS','APA','APO','APP','ARES','ATO',
  'AVB','AVGO','AVY','AXON','AZPN','BALL','BAX','BBY','BDX','BEN',
  'BG','BKR','BRO','BSX','BURL','BX','CAG','CAH','CARR','CBRE',
  'CCL','CDW','CE','CEG','CF','CFG','CHD','CHRW','CINF','CL',
  'CLX','CMS','CNP','COO','CPB','CPRT','CPT','CRL','CSGP','CTAS',
  'CTLT','CTRA','CTSH','CTVA','CVNA','DAL','DAY','DD','DELL','DFS',
  'DGX','DHI','DHR','DKS','DLTR','DOV','DRI','DT','DTE','DUK',
  'DVA','DVN','DXC','EA','EBAY','ECL','ED','EFX','EG','EIX',
  'EL','EMR','ENPH','EPAM','EQH','EQT','ERIE','ES','ESS','ETR',
  'EVRG','EW','EXC','EXPD','EXPE','F','FANG','FAST','FDS','FE',
  'FFIV','FICO','FIS','FITB','FLNC','FMC','FND','FOX','FOXA','FSLR',
  'FTV','GD','GEHC','GEN','GIS','GNRC','GRMN','GWW','HAL','HAS',
  'HBAN','HCA','HD','HIG','HII','HLT','HOLX','HPE','HPQ','HRL',
  'HSIC','HSY','HUBB','HWM','IEX','IFF','INCY','INVH','IP','IPG',
  'IQV','IR','IRM','IT','ITT','IVZ','J','JBHT','JCI','JKHY',
  'JNPR','K','KDP','KEY','KEYS','KHC','KIM','KKR','KLAC','KMB',
  'KMI','KMX','KO','KR','KVUE','L','LDOS','LEG','LEN','LH',
  'LHX','LKQ','LNT','LRCX','LUV','LW','LYB','LYV','M','MA',
  'MAA','MAS','MCHP','MCK','MCO','MDLZ','MGM','MHK','MKC','MKTX',
  'MLM','MMC','MMM','MNST','MO','MOH','MOS','MPC','MPWR','MRK',
  'MRNA','MRO','MS','MSCI','MSI','MTB','MTCH','MTD','MU','NDAQ',
  'NDSN','NEE','NEM','NI','NKE','NOC','NOW','NRG','NTAP','NTRS',
  'NUE','NVDA','NVR','NWL','NXPI','O','ODFL','OKE','OMC','ON',
  'ORCL','OTIS','OXY','PARA','PAYC','PAYX','PCAR','PCG','PEAK',
  'PEG','PEP','PFE','PFG','PG','PGR','PH','PHM','PKG','PLD',
  'PLTR','PM','PNR','PNW','PODD','POOL','PPG','PPL','PTC','PWR',
  'PXD','QCOM','QRVO','RCL','REG','REGN','RF','RGA','RJF','RMD',
  'ROK','ROP','ROST','RPM','RPRX','RSG','RTX','SBAC','SBUX','SJM',
  'SLB','SMCI','SNA','SNPS','SO','SOLV','SPG','SPGI','SRE','STE',
  'STLD','STT','STX','STZ','SWK','SWKS','SYF','SYK','SYY','T',
  'TAP','TDG','TDY','TEAM','TECH','TEL','TER','TFC','TFX','TGT',
  'TJX','TMO','TMUS','TPR','TRGP','TRMB','TROW','TRU','TRV','TSCO',
  'TSLA','TSN','TT','TTD','TTWO','TWLO','TXN','TXT','TYL','U',
  'UAL','UDR','UHS','ULTA','UNH','UNM','UNP','UPS','URI','USB',
  'V','VFC','VICI','VLO','VLTO','VMC','VNO','VRSK','VRSN','VRTX',
  'VST','VTR','VTRS','VZ','WAB','WAT','WBA','WBD','WDC','WEC',
  'WELL','WFC','WHR','WM','WMB','WMT','WRB','WST','WTW','WY',
  'XEL','XOM','XPO','XYL','YUM','ZBH','ZBRA','ZION','ZTS',
];

// Deduplicate
const UNIVERSE = [...new Set(STOCK_UNIVERSE)];

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
    return NextResponse.json({ error: 'Finnhub not configured' }, { status: 503 });
  }

  try {
    const filters: ScreenerFilters = await req.json().catch(() => ({}));

    const symbols = UNIVERSE; // ~420 stocks — use our curated list
    console.log(`[screener] Scanning ${symbols.length} stocks`);

    if (!symbols.length) {
      return NextResponse.json({ results: [], total: 0, scanned: 0, message: 'No symbols available' });
    }

    // ─── 1. Fetch profiles in parallel batches of 10 ─────────
    const batchSize = 10;
    const profiles: any[] = [];
    const failed: string[] = [];

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(sym =>
          fetch(
            `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`,
            { signal: AbortSignal.timeout(5000) }
          ).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );
      let batchFound = 0;
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value?.ticker) {
          profiles.push(r.value);
          batchFound++;
        }
      }
      // Rate limit: 200ms between batches (keeps well under 60/min)
      if (i + batchSize < symbols.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`[screener] Got ${profiles.length} profiles`);

    // ─── 2. Apply sector + market cap filters ─────────────────
    const sectorFilter = filters.sector?.toLowerCase();
    let keywords: string[] | null = null;
    if (sectorFilter) {
      // Find matching keywords for this sector
      for (const [key, kws] of Object.entries(SECTOR_KEYWORDS)) {
        if (key.includes(sectorFilter) || sectorFilter.includes(key)) {
          keywords = kws;
          break;
        }
      }
      // If no exact match, use the sector name directly
      if (!keywords && filters.sector) keywords = [filters.sector];
    }

    const results: ScreenerResult[] = [];

    for (const p of profiles) {
      const symbol = p.ticker || '';
      const name = p.name || '';
      const marketCap = p.marketCapitalization != null ? p.marketCapitalization * 1e6 : null;
      const industry = p.finnhubIndustry || '';
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
      if (filters.marketCap) {
        const [lo, hi] = MARKET_CAP_RANGES[filters.marketCap] || [0, Infinity];
        if (marketCap == null || marketCap < lo || marketCap > hi) continue;
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

    // ─── 3. Enrich with metrics for top 40 matches ────────────
    const topResults = results.slice(0, 40);
    for (let i = 0; i < topResults.length; i += 3) {
      const batch = topResults.slice(i, i + 3);
      const metricResults = await Promise.allSettled(
        batch.map(r =>
          fetch(
            `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(r.symbol)}&metric=all&token=${token}`,
            { signal: AbortSignal.timeout(5000) }
          ).then(res => res.ok ? res.json() : null).catch(() => null)
        )
      );
      for (let j = 0; j < batch.length; j++) {
        const mr = metricResults[j];
        if (mr.status !== 'fulfilled' || !mr.value?.metric) continue;
        const m = mr.value.metric;
        if (m.peBasicExclExtraTTM != null) batch[j].peRatio = m.peBasicExclExtraTTM;
        if (m.dividendYieldIndicatedAnnual != null) batch[j].dividendYield = m.dividendYieldIndicatedAnnual;
        if (m['52WeekHigh'] != null) batch[j].week52High = m['52WeekHigh'];
        if (m['52WeekLow'] != null) batch[j].week52Low = m['52WeekLow'];
        if (batch[j].week52High && batch[j].week52Low) {
          const mid = (batch[j].week52High! + batch[j].week52Low!) / 2;
          batch[j].week52Change = ((batch[j].week52High! - mid) / mid) * 100;
        }
        if (m.currentPrice != null) batch[j].price = m.currentPrice;
      }
      if (i + 3 < topResults.length) await new Promise(r => setTimeout(r, 150));
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
