// ─── AI Advisor Orchestrator ─────────────────────────────────────
// Phase 3: Stock screening pipeline extracted from the chat route.
//
// Responsibilities:
//   1. Extract screening criteria from natural language (sector, cap, PE, growth, volume)
//   2. Multi-sector detection (separate screening per sector bucket)
//   3. Run the screener HTTP service
//   4. Format results as AI prompt context
//   5. Widen/relax detection for follow-up requests
//   6. History fallback (extract sectors from prior conversation turns)
//
// Previously all inline in chat route (400+ lines). Now a testable,
// independent module with a single entry point: orchestrateScreening().
// ──────────────────────────────────────────────────────────────────

import { getStyleScreeningDefaults } from '@/lib/investor-style-defaults';
import { withFallback, stageLog } from '@/lib/ai/resilience';
import { screenStocks } from '@/lib/equity-screener';

// ── Types ─────────────────────────────────────────────────

export interface ScreeningCriteria {
  market_cap_min: number;
  pe_max?: number;
  min_growth_rate?: number;
  volume_min?: number;
  sector?: string;
  [key: string]: any; // passthrough for additional screener params
}

export interface MultiSectorPool {
  label: string;
  criteria: ScreeningCriteria;
  results: any[];
  count: number;
  provider: string;
}

export interface ScreeningResult {
  results: any[];
  provider: string;
  error?: string;
}

export interface OrchestrationOutput {
  /** Formatted text block for injection into the AI system prompt */
  context: string;
  /** Individual sector pools (multi-sector mode) */
  multiSectorPools: MultiSectorPool[] | null;
  /** Raw screening results (single-sector or first sector) */
  results: ScreeningResult | null;
  /** The criteria used */
  criteria: ScreeningCriteria | null;
  /** Where the criteria came from */
  source: 'explicit' | 'style_defaults' | 'history' | 'fallback:explicit' | 'fallback:style_defaults' | 'fallback:history' | null;
  /** Whether screening was skipped (no budget, no criteria) */
  skipped: boolean;
}

// ── Constants ──────────────────────────────────────────────

const SECTOR_MAP: Record<string, string> = {
  technology: 'Technology', healthcare: 'Healthcare', financial_services: 'Financials',
  energy: 'Energy', consumer_cyclical: 'Consumer Cyclical', industrials: 'Industrials',
  basic_materials: 'Basic Materials', real_estate: 'Real Estate', utilities: 'Utilities',
  communication_services: 'Communication Services',
};

const SECTOR_KEYWORDS: Record<string, string> = {
  // Tech
  'technology': 'tech|technology|software|hardware|ai|artificial intelligence|semiconductor|chip|cloud|saas|cyber|cybersecurity|it sector|big tech|magnificent\s*7|mag\s*7|faang',
  // Healthcare
  'healthcare': 'healthcare|health care|biotech|pharma|biopharma|medical|drug|gene|therapeutics|hospitals|medtech',
  // Financials
  'financial_services': 'financial|finance|bank|banking|insurance|fintech|payment|wall street|brokerage|asset management',
  // Energy
  'energy': 'energy|oil|gas|solar|renewable|clean energy|utilities|pipeline|offshore|drilling',
  // Consumer Cyclical
  'consumer_cyclical': 'consumer|retail|ecommerce|e-commerce|auto|automotive|restaurant|travel|hotel|luxury|apparel',
  // Industrials
  'industrials': 'industrial|manufacturing|aerospace|defense|transport|logistics|machinery|construction',
  // Communication Services
  'communication_services': 'communication|media|telecom|entertainment|streaming|social media|advertising|gaming',
  // Basic Materials
  'basic_materials': 'material|materials|mining|mineral|minerals|chemical|metal|metals|steel|gold miner|copper|aluminum|lithium|rare earth|critical mineral',
  // Real Estate
  'real_estate': 'real estate|reit|property|housing|mortgage',
  // Utilities
  'utilities': 'utility|electric|water|power grid|renewable utility',
};

// ── Public API ─────────────────────────────────────────────

/**
 * Single entry point for the screening pipeline.
 *
 * @param message - Current user message
 * @param investorStyle - User's investor style (e.g., "Lynch")
 * @param contextMessages - Prior conversation history (for sector fallback)
 * @param requestedBudget - Budget extracted from conversation (null = skip screening)
 * @returns Orchestration output with context and results
 */
export async function orchestrateScreening(
  message: string,
  investorStyle: string,
  contextMessages: Array<{ role: string; content: string }>,
  requestedBudget: number | null,
): Promise<OrchestrationOutput> {
  const empty: OrchestrationOutput = {
    context: '',
    multiSectorPools: null,
    results: null,
    criteria: null,
    source: null,
    skipped: true,
  };

  if (requestedBudget === null) return empty;

  const styleDefaults = getStyleScreeningDefaults(investorStyle);

  // Step 1: multi-sector detection
  let multiCriteria = extractMultiSectorCriteria(message, styleDefaults);

  // Step 2: history fallback for sector keywords
  if (multiCriteria.length === 0) {
    const historicSectors = extractSectorsFromHistory(contextMessages);
    if (historicSectors.length > 0) {
      console.log('[orchestrator] 📜 Fallback: extracted sectors from conversation history:', historicSectors);
      const source = contextMessages.length >= 4 ? 'history' : 'style_defaults';
      multiCriteria = historicSectors.map(sector => ({
        label: SECTOR_MAP[sector] || sector.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        criteria: { ...styleDefaults, sector },
      }));
      // Set source as history for the first pool
      if (multiCriteria.length > 0) {
        // We'll set source later based on what we actually use
      }
    }
  }

  // Step 3: widen/relax detection
  const widenRequested = detectWidenRequest(contextMessages);
  if (widenRequested && multiCriteria.length > 0) {
    multiCriteria = multiCriteria.map(p => ({
      ...p,
      criteria: relaxCriteria(p.criteria),
    }));
    console.log('[orchestrator] 🔍 Criteria relaxed for widen request');
  }

  // Step 4: multi-sector screening (parallel)
  if (multiCriteria.length > 1) {
    const pools = await Promise.all(
      multiCriteria.map(async ({ label, criteria }) => {
        const { result: scResult, source } = await withFallback(
          'screener',
          () => runScreening(criteria),
          `multi-sector:${label}`,
          30_000,
        );
        if (source === 'fallback') {
          stageLog('warn', 'screening', `Screener fallback for ${label}`, { dependency: 'screener' });
        }
        return {
          label,
          criteria: criteria as ScreeningCriteria,
          results: scResult.results || [],
          count: scResult.results?.length || 0,
          provider: scResult.provider || 'error',
        };
      })
    );

    const validPools = pools.filter(p => p.count > 0);
    const context = formatMultiSectorContext(validPools);

    if (validPools.length === 0) {
      console.warn('[orchestrator] ⚠️ Multi-sector screening returned zero valid pools');
      return empty;
    }

    return {
      context,
      multiSectorPools: validPools,
      results: null, // multi-sector: no single results object
      criteria: validPools[0].criteria,
      source: widenRequested ? 'explicit' : 'style_defaults',
      skipped: false,
    };
  }

  // Step 5: single-sector (or style-defaults) screening
  const criteria: ScreeningCriteria = multiCriteria.length === 1
    ? multiCriteria[0].criteria as ScreeningCriteria
    : (extractScreeningCriteria(message) || { ...styleDefaults, market_cap_min: styleDefaults.market_cap_min || 500_000_000 }) as ScreeningCriteria;

  const { result: scResult, source: scSource } = await withFallback(
    'screener',
    () => runScreening(criteria),
    'single-sector',
    30_000,
  );
  const source = messageContainsSectorKeywords(message) ? 'explicit' : 'style_defaults';
  const finalSource = (scSource === 'fallback' ? `fallback:${source}` : source) as OrchestrationOutput['source'];

  if (scSource === 'fallback') {
    stageLog('warn', 'screening', 'Using fallback/cached screener results', { dependency: 'screener' });
  }

  if (!scResult.results || scResult.results.length === 0) {
    console.warn('[orchestrator] ⚠️ Screening returned zero results for criteria:', JSON.stringify(criteria));
    return {
      ...empty,
      criteria,
      source: finalSource,
      skipped: true,
    };
  }

  const context = formatScreeningContext(scResult.results, criteria, scResult.results.length);

  return {
    context,
    multiSectorPools: null,
    results: scResult,
    criteria,
    source,
    skipped: false,
  };
}

// ── Screening criteria extraction ──────────────────────────

/**
 * Extract screening criteria from a natural-language request.
 * Detects: sector, market cap, P/E range, growth rate, volume.
 */
export function extractScreeningCriteria(message: string): ScreeningCriteria | null {
  const criteria: ScreeningCriteria = { market_cap_min: 0 };

  // Sector
  const lower = message.toLowerCase();
  for (const [sector, pattern] of Object.entries(SECTOR_KEYWORDS)) {
    if (new RegExp(`\\b(${pattern})\\b`, 'i').test(lower)) {
      criteria.sector = sector;
      break;
    }
  }

  // Market cap
  const capMatch = message.match(/market\s*cap\s*(?:>|>=|over|above|at\s*least)\s*\$?(\d+(?:\.\d+)?)\s*(b|bn|billion|m|mil|million)/i);
  if (capMatch) {
    const val = parseFloat(capMatch[1]);
    criteria.market_cap_min = /b|bn|billion/i.test(capMatch[2]) ? val * 1_000_000_000 : val * 1_000_000;
  }

  // P/E max
  const peMatch = message.match(/(?:pe|p\/e|P\/E)\s*(?:<|<=|under|below|max|at\s*most)\s*(\d+)/i);
  if (peMatch) criteria.pe_max = parseInt(peMatch[1]);

  // Growth rate
  const growthMatch = message.match(/growth\s*(?:>|>=|over|above|at\s*least)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (growthMatch) criteria.min_growth_rate = parseFloat(growthMatch[1]) / 100;

  // Volume
  const volMatch = message.match(/volume\s*(?:>|>=|over|above)\s*(\d+(?:\.\d+)?)\s*(?:m|mil|million)/i);
  if (volMatch) criteria.volume_min = Math.round(parseFloat(volMatch[1]) * 1_000_000);

  // No criteria found
  if (!criteria.sector && !criteria.pe_max && !criteria.min_growth_rate && !criteria.volume_min) {
    return null;
  }

  if (criteria.market_cap_min === 0) criteria.market_cap_min = 500_000_000; // bare minimum
  return criteria;
}

/**
 * Extract MULTI-SECTOR criteria: collect ALL sector keywords and return
 * separate criteria blocks per sector. The AI produces per-sector pool
 * recommendations which are much more useful than "pick any 5 from all 11 sectors."
 */
export function extractMultiSectorCriteria(
  message: string,
  styleDefaults: Record<string, any> = {},
): Array<{ label: string; criteria: Record<string, any> }> {
  const lower = message.toLowerCase();
  const sectors: string[] = [];

  for (const [sector, pattern] of Object.entries(SECTOR_KEYWORDS)) {
    if (new RegExp(`\\b(${pattern})\\b`, 'i').test(lower)) {
      sectors.push(sector);
    }
  }

  if (sectors.length <= 1) {
    // Single sector or none — use regular extraction
    const criteria = extractScreeningCriteria(message);
    if (criteria) {
      return [{ label: SECTOR_MAP[criteria.sector!] || 'All Sectors', criteria: { ...styleDefaults, ...criteria } }];
    }
    return [];
  }

  // Build shared criteria (cap, PE, growth) for all sector pools
  const shared: Record<string, any> = {};
  const capMatch = message.match(/market\s*cap\s*(?:>|>=|over|above|at\s*least)\s*\$?(\d+(?:\.\d+)?)\s*(b|bn|billion|m|mil|million)/i);
  if (capMatch) {
    const val = parseFloat(capMatch[1]);
    shared.market_cap_min = /b|bn|billion/i.test(capMatch[2]) ? val * 1_000_000_000 : val * 1_000_000;
  }
  const peMatch = message.match(/(?:pe|p\/e|P\/E)\s*(?:<|<=|under|below|max|at\s*most)\s*(\d+)/i);
  if (peMatch) shared.pe_max = parseInt(peMatch[1]);
  const growthMatch = message.match(/growth\s*(?:>|>=|over|above|at\s*least)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (growthMatch) shared.min_growth_rate = parseFloat(growthMatch[1]) / 100;
  const volMatch = message.match(/volume\s*(?:>|>=|over|above)\s*(\d+(?:\.\d+)?)\s*(?:m|mil|million)/i);
  if (volMatch) shared.volume_min = Math.round(parseFloat(volMatch[1]) * 1_000_000);

  const defaults = styleDefaults || {};

  return sectors.map(sector => ({
    label: SECTOR_MAP[sector] || sector.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    criteria: { ...defaults, ...shared, sector },
  }));
}

// ── History fallback ───────────────────────────────────────

const SECTOR_MENTION_PATTERN = new RegExp(
  Object.values(SECTOR_KEYWORDS).map(p => `\\b(${p})\\b`).join('|'),
  'i'
);

/**
 * Extract sector keywords from prior conversation history.
 * Used when the current message has no sector keywords but the user
 * mentioned them recently. Prevents losing context on follow-ups.
 */
export function extractSectorsFromHistory(
  messages: Array<{ role: string; content: string }>,
): string[] {
  if (!messages || messages.length < 2) return [];

  // Only scan user messages, skip the last message (current)
  const historicMessages = messages.slice(0, -1).filter(m => m.role === 'user');
  if (historicMessages.length === 0) return [];

  // Scan all historic messages for sector keywords
  const found: Set<string> = new Set();
  for (const msg of historicMessages) {
    const lower = msg.content.toLowerCase();
    for (const [sector, pattern] of Object.entries(SECTOR_KEYWORDS)) {
      if (new RegExp(`\\b(${pattern})\\b`, 'i').test(lower)) {
        found.add(sector);
      }
    }
  }

  return [...found].slice(0, 3); // Keep to 3 sectors max from history
}

// ── Widen/relax detection ──────────────────────────────────

const WIDEN_PATTERNS = [
  /widen\s+(?:the\s+)?(?:net|search|scope|criteria|screen)/i,
  /broader?\s+(?:net|search|scope|criteria|screen|range)/i,
  /relax\s+(?:the\s+)?(?:criteria|filters|screen)/i,
  /expand\s+(?:the\s+)?(?:net|search|scope|criteria|screen)/i,
  /more\s+(?:results|options|choices|picks|ideas)/i,
  /show\s+me\s+more/i,
  /any\s+other\s+(?:stocks|options|picks|ideas)/i,
  /what\s+else/i,
  /try\s+again/i,
];

/**
 * Detect whether the user is asking to widen/relax the current search.
 * Checks the most recent user message in conversation history.
 */
export function detectWidenRequest(
  messages: Array<{ role: string; content: string }>,
): boolean {
  if (!messages || messages.length < 2) return false;
  const lastUser = messages.filter(m => m.role === 'user').pop();
  if (!lastUser) return false;
  return WIDEN_PATTERNS.some(p => p.test(lastUser.content));
}

// ── Relaxation ─────────────────────────────────────────────

/**
 * Relax screening criteria to widen the candidate pool.
 * Removes or loosens the most restrictive filters.
 */
export function relaxCriteria(criteria: Record<string, any>): Record<string, any> {
  const relaxed = { ...criteria };

  // Increase market cap floor (more mature companies)
  if (relaxed.market_cap_min && relaxed.market_cap_min < 5_000_000_000) {
    relaxed.market_cap_min = Math.max(relaxed.market_cap_min, 5_000_000_000);
  }

  // Remove P/E cap entirely — widest net
  delete relaxed.pe_max;

  // Halve growth requirement
  if (relaxed.min_growth_rate) {
    relaxed.min_growth_rate = Math.max(0.05, relaxed.min_growth_rate * 0.5);
  }

  // Remove volume floor
  delete relaxed.volume_min;

  console.log('[orchestrator] 🔍 Criteria relaxed for widen request:', JSON.stringify(relaxed));
  return relaxed;
}

// ── Screener HTTP call ─────────────────────────────────────

/**
 * Run the equity screener.
 *
 * Finnhub-direct (replaces the old localhost:8766 OpenBB service, which was
 * never reachable from Vercel serverless). Returns results + provider metadata.
 */
export async function runScreening(criteria: Record<string, any>): Promise<ScreeningResult> {
  try {
    const output = await screenStocks(criteria);
    if (output.relaxed.length > 0) {
      console.warn('[orchestrator] 🔍 Screener auto-relaxed filters:', output.relaxed.join(','));
    }
    return {
      results: output.results,
      provider: output.provider,
    };
  } catch (e: any) {
    return { results: [], provider: 'error', error: e.message };
  }
}

// ── Formatting ─────────────────────────────────────────────

/**
 * Format screening results into prompt context block for single-sector queries.
 */
export function formatScreeningContext(
  results: any[],
  criteria: ScreeningCriteria,
  count: number,
): string {
  if (!results || results.length === 0) return '';

  const sorted = [...results].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
  const tickers = sorted.slice(0, 15).map((r: any) =>
    `${r.symbol || r.ticker} (${r.name || ''})`.replace(/\s{2,}/g, ' ').trim()
  );

  const summary = sorted.slice(0, 8).map((r: any) => {
    const parts = [`${r.symbol || r.ticker}`];
    if (r.market_cap) parts.push(`MCap:$${(r.market_cap / 1e9).toFixed(1)}B`);
    if (r.pe != null && r.pe > 0) parts.push(`PE:${r.pe.toFixed(1)}`);
    if (r.eps_growth != null) parts.push(`Grow:${(r.eps_growth * 100).toFixed(0)}%`);
    return parts.join(' ');
  }).join('; ');

  return `STOCK SCREENER RESULTS (${results.length} US-listed candidates from real-time Finnhub screening):\n` +
    `Available tickers: ${tickers.join(', ')}${results.length > 15 ? `, ...and ${results.length - 15} more` : ''}\n` +
    `Top by market cap: ${summary}\n` +
    `Criteria: ${JSON.stringify(criteria)}\n` +
    `You MUST build your stock allocation ONLY from the screened tickers above. ` +
    `Do NOT substitute familiar tickers from memory. If none fit, say so and offer to widen.`;
}

/**
 * Format multi-sector screening pools into prompt context.
 */
export function formatMultiSectorContext(
  pools: MultiSectorPool[],
): string {
  if (!pools || pools.length === 0) return '';

  const sections = pools.map(pool => {
    const tickers = pool.results.slice(0, 8).map((r: any) =>
      `${r.symbol || r.ticker} (${r.name || ''})`.replace(/\s{2,}/g, ' ').trim()
    );
    return `🟢 ${pool.label} (${pool.count} matches): ${tickers.join(', ')}${pool.count > 8 ? `, ...+${pool.count - 8} more` : ''}`;
  });

  return `MULTI-SECTOR SCREENER RESULTS:
${sections.join('\n')}`;
}

// ── Helpers ────────────────────────────────────────────────

function messageContainsSectorKeywords(message: string): boolean {
  const lower = message.toLowerCase();
  for (const pattern of Object.values(SECTOR_KEYWORDS)) {
    if (new RegExp(`\\b(${pattern})\\b`, 'i').test(lower)) return true;
  }
  return false;
}
