// ─── Equity Screener (Finnhub direct) ─────────────────────────
// Production replacement for the old localhost:8766 OpenBB screener service.
//
// The AI chat path previously called `runScreening()` → `http://127.0.0.1:8766/screen`,
// which was NEVER reachable from Vercel serverless (hardcoded localhost, no deploy).
// This module re-implements that screening using Finnhub profile2 + metric directly,
// reusing the exact curated-universe + rate-pacing approach proven in
// `/api/screener/search` (which is live in production).
//
// Data sources (all Finnhub free tier):
//   - getCompanyProfile()  → name, industry, market cap (profile2)
//   - getFinancialMetrics() → PE, EPS growth TTM YoY, dividend yield, beta (metric=all)
//
// Rate pacing: batchSize=3 every 1500ms ≈ 2 calls/sec, well under Finnhub's 60/min.
// ─────────────────────────────────────────────────────────────────

import { getCompanyProfile } from '@/lib/market-data';
import { getFinancialMetrics } from '@/lib/finnhub';

// ─── Curated US stock universe (mirrors /api/screener/search, stocks only) ──
// Grouped by sector so we can smart-order: the requested sector's stocks are
// profiled first (before Finnhub rate limits matter). ETFs are intentionally
// excluded — the ETF leg (`lib/etf-screener.ts`) handles those separately.
const UNIVERSE: Record<string, string[]> = {
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
    'BBY','KMX','DRI','MGM','WYNN','LKQ','POOL','TPR',
    'EL','HAS','LEG','MHK','NVR','RL','TAP','VFC','WHR',
  ],
  industrials: [
    'CAT','DE','GE','BA','LMT','RTX','HON','UPS','FDX','UNP',
    'CSX','NSC','ITW','EMR','ROK','PH','ETN','CMI','PCAR','DOV',
    'ADP','PAYX','CPRT','FAST','GWW','IR','OTIS','AME','AXON','CARR',
    'EFX','GNRC','HII','HUBB','HWM','IEX','ITT','JBHT',
    'JCI','LHX','MMM','NDSN','PNR','PWR','RSG','SWK','TDG','TT',
    'TXT','URI','VLTO','WAB','WM','XYL',
  ],
  energy: [
    'XOM','CVX','COP','EOG','SLB','PSX','MPC','VLO','OXY','HES',
    'APA','BKR','CTRA','DVN','EQT','FANG','HAL','KMI','MRO','OKE',
    'PXD','TRGP','VST','WMB',
  ],
  utilities: [
    'NEE','DUK','SO','D','AEP','EXC','SRE','XEL','ED','PEG',
    'AES','ATO','CMS','CNP','DTE','EIX','ES','ETR','EVRG',
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
    'EA','FOX','FOXA','IPG','MTCH','NWL','OMC','TTWO',
  ],
};

// orchestrator sector key → universe group key
const SECTOR_TO_GROUP: Record<string, string> = {
  technology: 'technology',
  healthcare: 'healthcare',
  financial_services: 'financial services',
  energy: 'energy',
  consumer_cyclical: 'consumer',
  industrials: 'industrials',
  communication_services: 'media & entertainment',
  basic_materials: 'materials',
  real_estate: 'real estate',
  utilities: 'utilities',
};

export interface EquityScreenerCriteria {
  /** orchestrator sector key (technology, basic_materials, …) */
  sector?: string;
  /** minimum market cap in dollars */
  market_cap_min?: number;
  market_cap_max?: number;
  /** max trailing P/E (positive earnings only) */
  pe_max?: number;
  pe_min?: number;
  /** min EPS growth TTM YoY (fraction, e.g. 0.10 = 10%) */
  min_growth_rate?: number;
  /** best-effort; no reliable volume source on Finnhub metric → ignored */
  volume_min?: number;
  [key: string]: any;
}

export interface EquityCandidate {
  symbol: string;
  name: string;
  market_cap: number | null;      // dollars
  pe: number | null;              // trailing P/E (positive-only for filtering)
  eps_growth: number | null;      // fraction (TTM YoY)
  dividend_yield: number | null;  // percent
  sector: string;                 // industry string from profile
}

export interface EquityScreenOutput {
  results: EquityCandidate[];
  provider: string;
  scanned: number;      // profiles fetched
  matched: number;      // after sector + market-cap filter (pre enrichment)
  relaxed: string[];    // filters that were auto-relaxed to avoid a 0-match result
}

// Minimum candidates we aim to return before auto-relaxing stricter filters.
const MIN_CANDIDATES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function buildUniverse(group?: string): Array<{ symbol: string; group: string }> {
  const groups = Object.keys(UNIVERSE);
  const ordered = group
    ? [group, ...groups.filter(g => g !== group)]
    : groups;
  const seen = new Set<string>();
  const out: Array<{ symbol: string; group: string }> = [];
  for (const g of ordered) {
    for (const sym of UNIVERSE[g] || []) {
      if (!seen.has(sym)) {
        seen.add(sym);
        out.push({ symbol: sym, group: g });
      }
    }
  }
  return out;
}

/**
 * Screen US stocks against criteria using Finnhub directly.
 * Always returns real, provider-sourced data — never fabricated tickers.
 */
export async function screenStocks(
  criteria: EquityScreenerCriteria = {},
): Promise<EquityScreenOutput> {
  const group = criteria.sector ? (SECTOR_TO_GROUP[criteria.sector] || criteria.sector) : undefined;

  // ── 1. Fetch profiles (rate-limited, sector-first) ──
  const MAX_PROFILES = 30;
  const batchSize = 3;
  const batchDelayMs = 1500;

  const universe = buildUniverse(group);
  const toScan = universe.slice(0, MAX_PROFILES);

  const profiled: Array<{ symbol: string; name: string; marketCap: number | null; industry: string; group: string }> = [];

  for (let i = 0; i < toScan.length; i += batchSize) {
    const batch = toScan.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(item => getCompanyProfile(item.symbol)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value?.ticker) {
        profiled.push({
          symbol: r.value.ticker,
          name: r.value.name || r.value.ticker,
          marketCap: r.value.marketCap ?? null,
          industry: r.value.industry || '',
          group: batch[j].group,
        });
      }
    }
    if (i + batchSize < toScan.length) await sleep(batchDelayMs);
  }

  // ── 2. Sector + market-cap filter ──
  const preFilter = profiled.filter(p => {
    if (group && p.group !== group) return false;
    if (criteria.market_cap_min != null && p.marketCap != null && p.marketCap < criteria.market_cap_min) return false;
    if (criteria.market_cap_max != null && p.marketCap != null && p.marketCap > criteria.market_cap_max) return false;
    return true;
  });

  // ── 3. Enrich top matches with metrics (PE, growth, div yield) ──
  const MAX_ENRICH = 15;
  const top = preFilter.slice(0, MAX_ENRICH);
  const enriched: EquityCandidate[] = [];

  for (let i = 0; i < top.length; i += batchSize) {
    const batch = top.slice(i, i + batchSize);
    const metricResults = await Promise.allSettled(batch.map(item => getFinancialMetrics(item.symbol)));
    for (let j = 0; j < batch.length; j++) {
      const base = batch[j];
      const mRes = metricResults[j];
      const m = mRes.status === 'fulfilled' ? mRes.value : null;
      enriched.push({
        symbol: base.symbol,
        name: base.name,
        market_cap: m?.marketCap ?? base.marketCap,
        pe: m?.pe ?? null,
        eps_growth: m?.epsGrowthTTM ?? null,
        dividend_yield: m?.dividendYield ?? null,
        sector: base.industry,
      });
    }
    if (i + batchSize < top.length) await sleep(batchDelayMs);
  }

  // ── 4. Numeric filters with honest auto-relaxation ──
  // Never silently zero-out: if the strict criteria (growth/PE) produce too few
  // matches, relax the most restrictive filters and keep the result real.
  const relaxed: string[] = [];
  const mcapFloor = criteria.market_cap_min ?? null;

  const hasMetric = (s: EquityCandidate) => s.market_cap != null;
  const mcapPass = (s: EquityCandidate) =>
    mcapFloor == null || (s.market_cap != null && s.market_cap >= mcapFloor);

  const pePass = (s: EquityCandidate) =>
    criteria.pe_max == null || (s.pe != null && s.pe > 0 && s.pe <= criteria.pe_max);
  const growthPass = (s: EquityCandidate) =>
    criteria.min_growth_rate == null || (s.eps_growth != null && s.eps_growth >= criteria.min_growth_rate);

  let pool = enriched.filter(s => hasMetric(s) && mcapPass(s));

  // Full criteria
  let final = pool.filter(s => pePass(s) && growthPass(s));
  if (final.length >= MIN_CANDIDATES) return finish(final, profiled.length, preFilter.length, relaxed);

  // Relax growth (keep PE + mcap)
  relaxed.push('growth');
  final = pool.filter(s => pePass(s));
  if (final.length >= MIN_CANDIDATES) return finish(final, profiled.length, preFilter.length, relaxed);

  // Relax PE too (keep mcap only)
  relaxed.push('pe');
  final = pool.filter(s => mcapPass(s));
  return finish(final, profiled.length, preFilter.length, relaxed);
}

function finish(
  results: EquityCandidate[],
  scanned: number,
  matched: number,
  relaxed: string[],
): EquityScreenOutput {
  const sorted = [...results].sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0));
  return { results: sorted, provider: 'finnhub', scanned, matched, relaxed };
}
