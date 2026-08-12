// ─── ETF Screening Engine ─────────────────────────────────────
// Part A of the ETF discovery path. Fund-appropriate screening:
//   - Discovery universe via Finnhub /etf/list (genuine ~2000+ ETF scan)
//   - Enrichment via Yahoo fundProfile/fundPerformance (expense ratio,
//     category, fund family, AUM, trailing 1y/3y/5y returns, yield)
//   - Criteria: category/sector focus, expense-ratio ceiling, AUM floor,
//     yield floor, trailing-return floors, index-tracked keyword.
//
// Shared by the HTTP route (`/api/screener/etf`) and the AI chat pipeline.
// ────────────────────────────────────────────────────────────────

import type { EtfProfile } from '@/lib/market-data';

// ── Types ────────────────────────────────────────────────────

export interface EtfScreenerCriteria {
  categories: string[];          // detected category keys (see ETF_CATEGORY_KEYWORDS)
  expenseRatioMax: number | null; // percent (e.g. 0.50 = 0.50%)
  aumMin: number | null;         // USD
  yieldMin: number | null;       // percent (e.g. 5 = 5%)
  return1yMin: number | null;    // percent
  return3yMin: number | null;    // percent
  return5yMin: number | null;    // percent
  indexTracked: string | null;   // keyword (e.g. "S&P 500")
}

/** Serialized result — omits the long `description` field. */
export interface EtfScreenerResult {
  symbol: string;
  name: string;
  category: string | null;
  fundFamily: string | null;
  expenseRatioPct: number | null;
  aum: number | null;
  dividendYieldPct: number | null;
  return1yPct: number | null;
  return3yPct: number | null;
  return5yPct: number | null;
  indexTracked: string | null;
}

export interface EtfScreenOutput {
  results: EtfScreenerResult[];
  scanned: number;   // number of candidates enriched
  total: number;     // matches after filters
  universe: number;  // size of discovery universe loaded
}

// ── Category keywords (fund-focus, not stock sectors) ─────────

export const ETF_CATEGORY_KEYWORDS: Record<string, { label: string; patterns: RegExp }> = {
  healthcare: { label: 'Healthcare', patterns: /\bhealth|healthcare|pharma|biotech|biopharma|medical|drug|genomic|oncology|hospital|\bXLV\b|\bVHT\b|\bIBB\b|\bXBI\b|\bIYH\b|\bIHI\b|\bPSCH\b/i },
  technology: { label: 'Technology', patterns: /\btech(?:nology)?\b|software|semiconductor|chips?\b|cloud|cyber|artificial intelligence|\bAI\b|robotic|internet|information technology|\bXLK\b|\bVGT\b|\bSMH\b|\bSOXX\b|\bIYW\b|\bIGV\b|\bQTEC\b/i },
  financials: { label: 'Financials', patterns: /\bfinancial|bank(?:ing|s)?\b|insurance|fintech|payment|capital market|asset management|broker|\bXLR\b|\bXLF\b|\bVFH\b|\bIYG\b|\bIYF\b|\bKBE\b|\bKIE\b/i },
  industrials: { label: 'Industrials', patterns: /\bindustrial|manufactur|aerospace|defense|transport|logistic|machinery|construction|engineering|\bXLI\b|\bVIS\b|\bIYJ\b|\bITA\b|\bPPA\b/i },
  energy: { label: 'Energy', patterns: /\benergy|oil\b|gas\b|petroleum|renewable|solar|wind\b|clean energy|nuclear|uranium|\bXLE\b|\bVDE\b|\bICLN\b|\bTAN\b|\bURA\b|\bFAN\b/i },
  utilities: { label: 'Utilities', patterns: /\butilit|electric|water|power grid|\bXLU\b|\bVPU\b|\bIDU\b/i },
  real_estate: { label: 'Real Estate', patterns: /\breal estate|REIT|property|housing|mortgage|\bXLRE\b|\bVNQ\b|\bSCHH\b|\bIYR\b|\bRWR\b/i },
  materials: { label: 'Materials', patterns: /\bmaterial|mining|metal|steel|chemical|gold\b|silver\b|copper|lithium|\bXLB\b|\bVAW\b|\bGDX\b|\bSLV\b|\bGLD\b|\bCOPX\b/i },
  consumer: { label: 'Consumer', patterns: /\bconsumer|retail|staples?|discretionary|\bXLY\b|\bXLP\b|\bXRT\b|\bVDC\b|\bVCR\b|\bIYC\b/i },
  communication: { label: 'Communication', patterns: /\bcommunication|media|telecom|entertainment|streaming|\bXLC\b|\bVOX\b|\bFCOM\b/i },
  dividend: { label: 'Dividend/Income', patterns: /\bdividend|income|\bSCHD\b|\bVYM\b|\bDGRO\b|\bHDV\b|\bVIG\b|\bSPHD\b|\bDIVO\b|\bJEPI\b|\bJEPQ\b/i },
  bond: { label: 'Bond/Fixed Income', patterns: /\bbond|fixed income|treasury|aggregate|corporate bond|municipal|\bBND\b|\bAGG\b|\bTLT\b|\bLQD\b|\bHYG\b|\bMUB\b|\bTIP\b/i },
  international: { label: 'International', patterns: /\binternational|foreign|emerging|EAFE|developed markets|\bVEA\b|\bVWO\b|\bIEFA\b|\bEFA\b|\bVXUS\b|\bIXUS\b|\bEEM\b/i },
  broad: { label: 'Broad Market', patterns: /S&P\s*500|sp500|total (?:stock )?market|broad[- ]?market|core (?:US|equity|stock)?|\bSPY\b|\bVOO\b|\bIVV\b|\bVTI\b|\bITOT\b|\bSCHB\b|\bQQQ\b|\bIWM\b/i },
};

// ── Intent detection ─────────────────────────────────────────

/** Conservative check: does this request clearly want ETFs / index funds? */
export function detectEtfIntent(message: string): boolean {
  return /\bETFs?\b|\bexchange[- ]traded\b|\bindex funds?\b|\bindex[- ]tracking\b|\bpassive\b/i.test(message);
}

// ── Criteria extraction ──────────────────────────────────────

function pctAfter(label: string, lower: string): number | null {
  // "yield over 5%" / "expense ratio under 0.5%" (number AFTER the label)
  const m = lower.match(new RegExp(`${label}[^0-9]{0,40}?([0-9]+(?:\\.[0-9]+)?)\\s*%`));
  if (m) return parseFloat(m[1]);
  return null;
}

function pctBefore(label: string, lower: string): number | null {
  // "5% yield" / "7% dividend" (number BEFORE the label)
  const m = lower.match(new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*%\\s*${label}`));
  if (m) return parseFloat(m[1]);
  return null;
}

export function extractEtfCriteria(message: string): EtfScreenerCriteria {
  const lower = message.toLowerCase();

  const categories: string[] = [];
  for (const [key, def] of Object.entries(ETF_CATEGORY_KEYWORDS)) {
    if (def.patterns.test(message)) categories.push(key);
  }

  // Expense ratio ceiling
  let expenseRatioMax = pctAfter('expense\\s*ratio', lower)
    ?? pctAfter('(?:fees?|expense|cost)\\s*(?:under|below|less\\s*than|max(?:imum)?|up\\s*to)', lower);
  if (expenseRatioMax == null && /\b(low|cheap|minimal)\s*(?:fee|cost|expense)|cheapest|low-?cost\b/.test(lower)) {
    expenseRatioMax = 0.25;
  }

  // AUM floor
  let aumMin: number | null = null;
  const aumMatch = lower.match(/aum\s*(?:over|above|at\s*least|min(?:imum)?|≥|>)?\s*\$?([0-9.]+)\s*(million|m|billion|b)?/i)
    ?? lower.match(/(?:over|above|at\s*least|≥|>)\s*\$?([0-9.]+)\s*(million|m|billion|b)\s*(?:in\s*)?aum/i);
  if (aumMatch) {
    let val = parseFloat(aumMatch[1]);
    const unit = (aumMatch[2] || '').toLowerCase();
    if (unit.startsWith('b')) val *= 1e9;
    else if (unit.startsWith('m')) val *= 1e6;
    aumMin = val;
  } else if (/\bliquid\b|\bhigh\s*liquidity\b/.test(lower)) {
    aumMin = 500e6;
  }

  // Yield floor
  let yieldMin = pctAfter('(?:yield|dividend|income|distribution)\\s*(?:of\\s*)?(?:over|above|at\\s*least|min(?:imum)?|target|goal|≥|>)?', lower)
    ?? pctBefore('(?:yield|dividend|income|distribution)', lower);

  // Trailing return floor (defaults to 1y unless a period is explicit)
  let return1yMin: number | null = null;
  let return3yMin: number | null = null;
  let return5yMin: number | null = null;
  const period = lower.match(/\b(1|3|5)\s*-?year\b|\b(1|3|5)yr\b|\b(one|three|five)\s*year\b/i);
  const periodKey = period ? (period[0].match(/1|one/) ? '1' : period[0].match(/3|three/) ? '3' : period[0].match(/5|five/) ? '5' : null) : null;
  const retVal = pctAfter('(?:return|returned|performance)\\s*(?:over|above|at\\s*least|min(?:imum)?|≥|>)?', lower)
    ?? pctBefore('(?:return|returned)', lower);
  if (retVal != null) {
    if (periodKey === '3') return3yMin = retVal;
    else if (periodKey === '5') return5yMin = retVal;
    else return1yMin = retVal;
  }

  // Index tracked
  let indexTracked: string | null = null;
  const idxMatch = message.match(/S&P\s*500|Nasdaq-?100|Dow\s*Jones|Russell\s*2000|MSCI\s*\w+|FTSE\s*\w+|Bloomberg\s*(?:US\s*)?Agg/i);
  if (idxMatch) indexTracked = idxMatch[0];

  return { categories, expenseRatioMax, aumMin, yieldMin, return1yMin, return3yMin, return5yMin, indexTracked };
}

// ── Core screening ───────────────────────────────────────────

function mapResult(p: EtfProfile): EtfScreenerResult {
  return {
    symbol: p.symbol,
    name: p.name,
    category: p.category,
    fundFamily: p.fundFamily,
    expenseRatioPct: p.expenseRatioPct,
    aum: p.aum,
    dividendYieldPct: p.dividendYieldPct,
    return1yPct: p.return1yPct,
    return3yPct: p.return3yPct,
    return5yPct: p.return5yPct,
    indexTracked: p.indexTracked,
  };
}

function categoryMatch(res: EtfScreenerResult, categories: string[]): boolean {
  if (categories.length === 0) return true;
  const text = `${res.symbol} ${res.name} ${res.category || ''} ${res.indexTracked || ''}`;
  return categories.some(key => ETF_CATEGORY_KEYWORDS[key]?.patterns.test(text));
}

/**
 * Run the ETF discovery scan. Loads the universe, enriches the top
 * candidates (category-matching first), applies fund-appropriate filters,
 * and sorts by AUM (liquidity) descending.
 */
export async function screenEtfs(
  criteria: EtfScreenerCriteria,
  opts: { maxScan?: number; limit?: number } = {},
): Promise<EtfScreenOutput> {
  const { getEtfProfile, listEtfUniverse } = await import('@/lib/market-data');
  const maxScan = opts.maxScan ?? 24;
  const limit = opts.limit ?? 20;

  const universe = await listEtfUniverse();

  // Order: category-matching candidates first (so they're enriched within the cap).
  let ordered = universe.map(item => ({ ...item }));
  if (criteria.categories.length > 0) {
    ordered = universe
      .map(item => {
        const text = `${item.symbol} ${item.description}`;
        const score = criteria.categories.reduce((n, key) =>
          n + (ETF_CATEGORY_KEYWORDS[key]?.patterns.test(text) ? 1 : 0), 0);
        return { ...item, _score: score };
      })
      .sort((a, b) => (b._score as number) - (a._score as number))
      .map(({ _score, ...it }) => it as { symbol: string; description: string });
  }

  const toScan = ordered.slice(0, maxScan);
  const enriched: EtfScreenerResult[] = [];
  const batchSize = 3;
  const batchDelayMs = 600;

  for (let i = 0; i < toScan.length; i += batchSize) {
    const batch = toScan.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(item => getEtfProfile(item.symbol)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value) enriched.push(mapResult(r.value));
    }
    if (i + batchSize < toScan.length) {
      await new Promise(res => setTimeout(res, batchDelayMs));
    }
  }

  // Apply filters
  let filtered = enriched;
  if (criteria.expenseRatioMax != null) filtered = filtered.filter(e => e.expenseRatioPct != null && e.expenseRatioPct <= criteria.expenseRatioMax!);
  if (criteria.aumMin != null) filtered = filtered.filter(e => e.aum != null && e.aum >= criteria.aumMin!);
  if (criteria.yieldMin != null) filtered = filtered.filter(e => e.dividendYieldPct != null && e.dividendYieldPct >= criteria.yieldMin!);
  if (criteria.return1yMin != null) filtered = filtered.filter(e => e.return1yPct != null && e.return1yPct >= criteria.return1yMin!);
  if (criteria.return3yMin != null) filtered = filtered.filter(e => e.return3yPct != null && e.return3yPct >= criteria.return3yMin!);
  if (criteria.return5yMin != null) filtered = filtered.filter(e => e.return5yPct != null && e.return5yPct >= criteria.return5yMin!);
  if (criteria.categories.length > 0) filtered = filtered.filter(e => categoryMatch(e, criteria.categories));
  if (criteria.indexTracked) {
    const idx = criteria.indexTracked.toLowerCase();
    filtered = filtered.filter(e => e.indexTracked != null && e.indexTracked.toLowerCase().includes(idx));
  }

  // Sort: AUM descending (liquidity proxy).
  filtered.sort((a, b) => (b.aum ?? 0) - (a.aum ?? 0));

  return {
    results: filtered.slice(0, limit),
    scanned: enriched.length,
    total: filtered.length,
    universe: universe.length,
  };
}

// ── Formatting (prompt context) ──────────────────────────────

function fmtAum(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return `${v}`;
}

/** Build the prompt context block. Enforces live expense/return citation. */
export function formatEtfContext(results: EtfScreenerResult[], criteria: EtfScreenerCriteria): string {
  if (!results || results.length === 0) return '';

  const lines = results.slice(0, 15).map(r => {
    const parts: string[] = [`${r.symbol} (${r.name})`];
    if (r.category) parts.push(`category=${r.category}`);
    if (r.expenseRatioPct != null) parts.push(`expenseRatio=${r.expenseRatioPct.toFixed(2)}%`);
    if (r.aum != null) parts.push(`AUM=$${fmtAum(r.aum)}`);
    if (r.dividendYieldPct != null) parts.push(`yield=${r.dividendYieldPct.toFixed(2)}%`);
    const rets: string[] = [];
    if (r.return1yPct != null) rets.push(`1y=${r.return1yPct.toFixed(1)}%`);
    if (r.return3yPct != null) rets.push(`3y=${r.return3yPct.toFixed(1)}%`);
    if (r.return5yPct != null) rets.push(`5y=${r.return5yPct.toFixed(1)}%`);
    if (rets.length) parts.push(`returns[${rets.join(', ')}]`);
    if (r.indexTracked) parts.push(`tracks=${r.indexTracked}`);
    return `  ${parts.join(' | ')}`;
  });

  return `SCREENED ETF UNIVERSE (${results.length} candidates, live fund data):\n${lines.join('\n')}\n\n` +
    `Build your ETF portfolio ONLY from the ETFs above. For EVERY ETF you recommend, you MUST cite its ` +
    `live expense ratio AND trailing 1y/3y/5y returns exactly as shown above. If a field is missing above, ` +
    `say "not available" — NEVER estimate expense ratios or returns from memory.`;
}
