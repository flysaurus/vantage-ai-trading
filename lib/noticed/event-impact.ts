/**
 * Event-impact trigger — deterministic news/event classifier for AI Noticed.
 *
 * Fires a proactive notice ONLY when a genuinely material company/sector
 * event (regulatory, earnings, corporate action, or product) is detected on a
 * ticker the user actually holds. Ordinary price movement, analyst ratings,
 * opinion/clickbait headlines, and rumor/speculation are explicitly rejected —
 * never fire on volatility alone, and never on a headline that merely mentions
 * the company in passing.
 *
 * Two severity tiers:
 *   - 'review': high-severity event → fires with `meta.action` = REVIEW_POSITION:<TICKER>
 *   - 'info':   moderate event      → fires with NO action (informational only)
 *
 * Relevance gate: an article must actually be ABOUT the holding — the headline
 * must contain the ticker or the company name (not just appear in a peer/macro
 * story). Fund/ETF positions are skipped (no company-level events).
 *
 * Severity is deterministic (keyword classification), not LLM-derived. The LLM
 * only generates the *wording* of the copy from the pre-classified context,
 * which is already tone-compliant (so the budget-exhausted fallback is too).
 *
 * Reuses the existing [ACTION:REVIEW_POSITION:TICKER] marker + ActionButton —
 * no new UI component. Read-only accounts navigate to the PositionCard
 * informationally via the existing onReviewPosition handler.
 */

import type { NoticedRuleInput, NoticedTrigger } from './engine';
import { getCompanyNews, getCompanyProfile } from '@/lib/finnhub';

// ── Config ──
const LOOKBACK_DAYS = 3;
const MAX_SYMBOLS = 10; // top holdings by market value (same fan-out as sentiment shift)

// ── Types ──
export type EventCategory = 'regulatory' | 'earnings' | 'corporate_action' | 'product';
export type EventSeverity = 'review' | 'info';

export interface EventCandidate {
  symbol: string;
  category: EventCategory;
  severity: EventSeverity;
  headline: string;
  source: string;
}

const CATEGORY_LABEL: Record<EventCategory, string> = {
  regulatory: 'regulatory',
  earnings: 'earnings',
  corporate_action: 'corporate action',
  product: 'product',
};

const CATEGORY_ICON: Record<EventCategory, string> = {
  regulatory: '⚖️',
  earnings: '📊',
  corporate_action: '🏛️',
  product: '🔬',
};

// ── Keyword classification (deterministic — no LLM in the firing path) ──
//
// REVIEW terms = high severity → REVIEW_POSITION action.
// INFO terms  = moderate/genuine event → informational, no action.
// Anything matching neither is treated as a non-event (price move, analyst
// rating, or general noise) and is rejected.

const REVIEW_TERMS: Record<EventCategory, string[]> = {
  regulatory: [
    'lawsuit', 'sues', 'sued', 'class action', 'investigation', 'subpoena',
    'indictment', 'indicted', 'charged with', 'charged', 'settlement', 'settles', 'fined',
    'penalty', 'antitrust', 'consent decree', 'fraud', 'misleading investors',
    'recall', 'recalls', 'data breach', 'cyberattack', 'cyber attack',
    'ransomware', 'SEC', 'DOJ', 'FTC', 'CFTC', 'cease and desist', 'probe',
    'halted trading', 'suspends operations', 'sanctions', 'enforcement action',
  ],
  earnings: [
    'misses earnings', 'earnings miss', 'profit warning', 'cuts guidance',
    'lowers guidance', 'slashes guidance', 'revenue miss', 'reports loss',
    'swings to loss', 'quarterly loss', 'warns on profit', 'warns of',
  ],
  corporate_action: [
    'acquisition', 'acquires', 'to acquire', 'merger', 'merges', 'merging',
    'takeover', 'going private', 'take private', 'bankruptcy', 'chapter 11',
    'chapter 7', 'delisting', 'delist', 'spin-off', 'spinoff', 'spin off',
    'dividend cut', 'cuts dividend', 'suspends dividend', 'dividend suspension',
    'CEO resigns', 'CEO steps down', 'CFO resigns', 'CFO steps down',
    'restructuring', 'winding down',
  ],
  product: [
    'FDA rejects', 'FDA rejection', 'clinical trial fails', 'phase 3 fails',
    'trial halted', 'trial fails', 'adverse events', 'product recall',
    'voluntary recall', 'safety issue', 'flaw', 'vulnerability', 'exploit',
  ],
};

const INFO_TERMS: Record<EventCategory, string[]> = {
  regulatory: [
    'regulatory filing', 'compliance', 'hearing', 'testimony',
    'regulatory review', 'settlement talks', 'files with SEC',
  ],
  earnings: [
    'beats earnings', 'earnings beat', 'tops estimates', 'raises guidance',
    'lifts guidance', 'record revenue', 'record profit', 'record quarter',
    'revenue beat', 'strong quarter', 'exceeds expectations',
  ],
  corporate_action: [
    'buyback', 'share repurchase', 'repurchase program', 'raises dividend',
    'dividend increase', 'increases dividend', 'new CEO', 'appoints CEO',
    'CEO appointed', 'partnership', 'strategic investment', 'expansion',
    'opens new', 'expansion plans', 'layoffs', 'lay off', 'job cuts',
    'names new CEO', 'names CEO', 'new chief executive',
  ],
  product: [
    'FDA approves', 'FDA approval', 'FDA clears', 'breakthrough therapy',
    'clinical trial positive', 'phase 3 positive', 'phase 3 meets',
    'wins contract', 'contract award', 'major contract', 'product launch',
    'launches', 'unveils', 'granted patent',
  ],
};

// Speculative/rumor markers — reject acquisition-style events that are only
// "in talks" rather than a definitive corporate action.
const RUMOR_TERMS = [
  'in talks', 'rumor', 'rumoured', 'speculation', 'reportedly', 'said to be',
  'is exploring', 'is considering', 'exploring a', 'considers', 'weighing',
  'may acquire', 'could acquire', 'may buy', 'could buy', 'may merge',
  'could merge', 'might acquire', 'might buy',
];

// Opinion/clickbait headline markers — these are not events.
const NOISE_HEADLINE_MARKERS = [
  'is a buy', 'buy now', 'a buy now', 'buy or sell', 'sell or hold',
  'buy, sell', 'time to buy', 'time to sell', 'should you buy', 'should you sell',
  'should i buy', 'should i sell', 'top pick', 'stock pick', 'best stocks',
  'top stocks', "here's why", 'here is why', "here's my", "here's how",
  'this is why', 'what it means', 'what that means', "what's next",
  'what to know', 'worth buying', 'worth it', "you'd need", 'you need',
  'if you', 'dividend champion', 'dividend king', 'dividend dogs',
  'wall street week', 'preview', 'premarket', 'midday movers',
];

// Fund/ETF names are skipped — they have no company-level events.
const FUND_NAME_KEYWORDS = [
  'etf', 'fund', 'spdr', 'ishares', 'vanguard', 'invesco', 'schwab',
  'proshares', 'wisdomtree', 'select sector', 'index fund', 'mutual fund',
];

const NAME_SUFFIX_WORDS = new Set([
  'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'plc', 'holdings',
  'group', 'the', 'and', 'class', 'adr', 'ads', 'sponsored', 'n.v.', 'nv',
  'sa', 'ag', 'se', 'limited', 'llc', 'lp',
]);

/** Whole-word (or phrase) case-insensitive match. */
function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function matchTerm(text: string, terms: string[]): boolean {
  return terms.some((t) => hasTerm(text, t));
}

/**
 * Strip legal-entity suffixes + single-letter tokens from a company name,
 * yielding the distinctive root used for headline relevance matching.
 */
export function nameRoot(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NAME_SUFFIX_WORDS.has(w))
    .join(' ');
}

/** True when the headline is actually ABOUT the holding (ticker or company name). */
export function isRelevantHeadline(headline: string, symbol: string, name: string): boolean {
  if (!headline) return false;
  const tickerRe = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (tickerRe.test(headline)) return true;
  const root = nameRoot(name);
  if (root && root.length >= 3 && headline.toLowerCase().includes(root)) return true;
  return false;
}

/** True when the headline is opinion/clickbait rather than a reported event. */
export function isNoiseHeadline(headline: string): boolean {
  const h = headline.toLowerCase();
  if (h.trim().endsWith('?')) return true;
  return NOISE_HEADLINE_MARKERS.some((m) => h.includes(m));
}

/** True when the resolved company name is a fund/ETF (no company-level events). */
export function isFundName(name: string): boolean {
  const n = name.toLowerCase();
  return FUND_NAME_KEYWORDS.some((k) => n.includes(k));
}

/**
 * Classify a HEADLINE into a material event (or null if not an event).
 *
 * Headline-only on purpose: the headline is the strongest, least-noisy signal
 * that an article is actually ABOUT a concrete event. Summaries pollute with
 * peer/macro context and opinion elaboration (e.g. an analyst-critic headline
 * whose summary happens to mention an NHTSA probe), which drove false positives.
 *
 * Deterministic: review terms win over info terms; rumor-only acquisition
 * speculation is rejected.
 */
export function classifyEvent(
  headline: string,
): { category: EventCategory; severity: EventSeverity } | null {
  const text = headline || '';
  if (!text.trim()) return null;

  const categories: EventCategory[] = ['regulatory', 'earnings', 'corporate_action', 'product'];

  for (const cat of categories) {
    if (matchTerm(text, REVIEW_TERMS[cat])) {
      // Reject speculative "in talks to acquire" noise — only definitive
      // corporate actions qualify for the review tier.
      if (cat === 'corporate_action' && matchTerm(text, RUMOR_TERMS)) {
        return null;
      }
      return { category: cat, severity: 'review' };
    }
  }

  for (const cat of categories) {
    if (matchTerm(text, INFO_TERMS[cat])) {
      if (cat === 'corporate_action' && matchTerm(text, RUMOR_TERMS)) {
        return null;
      }
      return { category: cat, severity: 'info' };
    }
  }

  return null;
}

/** Deterministic severity rank for picking the single most-severe event/symbol. */
function severityRank(s: EventSeverity): number {
  return s === 'review' ? 2 : 1;
}

/**
 * Find event-impact triggers: for each top holding, fetch its company profile
 * (name + fund check) and recent news, keep only headlines that are genuinely
 * ABOUT the holding, classify each, and emit at most one trigger per symbol
 * per day (single most-severe event).
 */
export async function findEventImpactTriggers(
  input: NoticedRuleInput,
  existingKeys: Set<string>,
): Promise<NoticedTrigger[]> {
  const triggers: NoticedTrigger[] = [];
  const heldSymbols = [...new Set(input.positions.map((p) => p.symbol.toUpperCase()))];
  if (heldSymbols.length === 0) return triggers;

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || process.env.FINNHUB_IO_API_KEY;
  if (!FINNHUB_KEY) return triggers;

  const today = new Date().toISOString().split('T')[0];
  const fromDate = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().split('T')[0];
  const lookbackTs = Date.now() - LOOKBACK_DAYS * 86400000;

  const top = [...input.positions]
    .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
    .slice(0, MAX_SYMBOLS);

  for (const pos of top) {
    const symbol = pos.symbol.toUpperCase();
    const key = `EVENT_${symbol}_${today}`;
    if (existingKeys.has(key)) continue;

    try {
      const [profile, articles] = await Promise.all([
        getCompanyProfile(symbol),
        getCompanyNews(symbol, fromDate, today),
      ]);
      const name = profile?.name || '';
      if (name && isFundName(name)) {
        console.log(`[noticed] Event impact: skip ${symbol} (fund/ETF: ${name})`);
        continue;
      }
      if (!articles || articles.length === 0) continue;

      const candidates: EventCandidate[] = [];
      for (const a of articles) {
        if (a.datetime && a.datetime * 1000 < lookbackTs) continue;
        const headline = a.headline || '';
        if (!isRelevantHeadline(headline, symbol, name)) continue;
        if (isNoiseHeadline(headline)) continue;
        const cls = classifyEvent(headline);
        if (!cls) continue;
        candidates.push({
          symbol,
          category: cls.category,
          severity: cls.severity,
          headline,
          source: a.source || 'news',
        });
      }
      if (candidates.length === 0) continue;

      // Single most-severe event for this symbol today.
      candidates.sort(
        (a, b) =>
          severityRank(b.severity) - severityRank(a.severity) ||
          a.category.localeCompare(b.category),
      );
      const best = candidates[0];
      const label = CATEGORY_LABEL[best.category];
      const icon = CATEGORY_ICON[best.category];
      const isReview = best.severity === 'review';

      const meta: Record<string, any> = {
        symbol,
        category: best.category,
        severity: best.severity,
        headline: best.headline,
        source: best.source,
      };
      if (isReview) meta.action = `REVIEW_POSITION:${symbol}`;

      triggers.push({
        trigger_type: 'event_impact',
        trigger_key: key,
        title: isReview ? `${symbol} — ${label} event` : `${symbol} — ${label} update`,
        variant: isReview ? 'warn' : 'accent',
        icon,
        meta,
        follow_up: isReview
          ? `What does this ${label} event mean for ${symbol}?`
          : `What happened with ${symbol}?`,
        context: isReview
          ? `${symbol}: ${label} event — ${best.headline} (${best.source}). severity: review. No action needed unless your original thesis has changed.`
          : `${symbol}: ${label} event — ${best.headline} (${best.source}). severity: info. Informational only — no action needed.`,
      });

      console.log(
        `[noticed] Event impact: ${symbol} — ${best.category}/${best.severity}: ${best.headline.slice(0, 80)}`,
      );
    } catch (err: any) {
      console.warn(`[noticed] Event-impact check failed for ${symbol}:`, err?.message || err);
    }
  }

  return triggers;
}
