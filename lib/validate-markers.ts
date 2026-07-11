// ─── Marker Validator ──────────────────────────────────────────
// Post-processes AI responses to validate [RECOMMEND:SYMBOL:BUY/SELL]
// markers against Finnhub company profiles. Catches hallucinated ADR
// tickers (e.g. SKM ≠ SK Hynix) before the user sees them.
//
// Called from /api/chat route after the AI stream completes.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

interface FinnhubSearchResult {
  symbol: string;
  description: string;
  type: string;
  displaySymbol: string;
}

interface FinnhubProfile {
  name: string;
  ticker: string;
  exchange: string;
  country?: string;
  currency?: string;
  finnhubIndustry?: string;
}

interface MarkerIssue {
  /** The symbol the AI recommended (may be wrong) */
  suggested: string;
  /** The context — what the AI called this company */
  contextName: string;
  /** null = couldn't determine, string = correct symbol, string[] = ambiguous */
  correction: string | string[] | null;
  /** Finnhub profile name for the suggested symbol (for logging) */
  profileName?: string;
}

const MARKER_REGEX = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z])?):(BUY|SELL)\]/g;

function getApiKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

/**
 * Extract company name mentions from text near a marker.
 * Looks for patterns like "SK Hynix", "Nvidia (NVDA)", "$TICKER (NAME)", etc.
 */
function extractContextName(text: string, symbol: string): string | null {
  // Look for patterns near the symbol in the text
  const idx = text.indexOf(symbol);
  if (idx < 0) return null;

  // Get surrounding context (±200 chars around the symbol occurrence)
  const start = Math.max(0, idx - 200);
  const end = Math.min(text.length, idx + 200);
  const context = text.slice(start, end);

  // Pattern 1: "Company Name [RECOMMEND:..." — company name before marker
  // The marker is [RECOMMEND:SYMBOL:BUY/SELL]
  // The text around it might be "...SK Hynix [RECOMMEND:SKM:BUY]..."
  const beforeMarker = text.slice(0, idx).split(/\n/).pop() || '';
  // Extract proper noun phrase before the symbol (2-4 capitalized words)
  const nameMatch = beforeMarker.match(
    /((?:[A-Z][a-zÀ-ÿ]+(?:\s+(?:[A-Z][a-zÀ-ÿ]+|&|and|of|in|at|the)\s*)*){1,4})\s*$/,
  );
  if (nameMatch) {
    const candidate = nameMatch[1].trim();
    // Filter out common non-company words
    if (!/^(?:The|A|An|This|That|Buy|Sell|Hold|Get|For|With|Your|My|I|We|You|It|At|In|On|By|To|Or|And|But|So|If|As|Is|Be|Are|Was|Were|Will|Can|Should|Would|Could|Do|Does|Did|Has|Have|Had|Go|Going|Like|Just|Also|Still|Now|Then|Here|There|Some|Any|All|Each|Every|Both|Few|More|Most|Other|Such|Only|Very|Really|About|Above|After|Again|From|Into|Over|Under|Up|Out|Off|Down|Back|Way|Time|Make|Made|Take|Look|See|Know|Think|Want|Need|Let|Put|Set|Use|Said|Done|Come)\b/i.test(candidate)) {
      return candidate;
    }
  }

  // Pattern 2: Scan for proper noun phrases mentioning the company in the context window
  // Look for "SK Hynix", "Nvidia Corp", etc.
  const properNounPattern = /\b([A-Z]{2,5}(?:\s+[A-Z][a-zÀ-ÿ]{2,}){0,3})\b/g;
  const matches = [...context.matchAll(properNounPattern)];
  for (const m of matches) {
    const phrase = m[1].trim();
    // Skip if it's the symbol itself
    if (phrase.toUpperCase() === symbol.toUpperCase()) continue;
    // Skip common non-company abbreviations
    if (/^(?:NYSE|NASDAQ|OTC|ADR|ETF|IPO|EPS|P\/E|EV|FOMC|CPI|GDP|CEO|CFO|CTO|COO|USD|EUR|GBP|YTD|Q[1-4]|H[1-2]|FY|AI|ML|API|UI|UX|ROI|KPI|OKR|SaaS|B2B|B2C|TAM|SAM|SOM|CAGR|DCF|IRR|ROE|ROA|EBIT|EBITDA|YoY|MoM|QoQ|USD|AM|PM)\b$/i.test(phrase)) continue;
    // Skip if it looks like a ticker (2-5 all-caps chars)
    if (/^[A-Z]{2,5}$/.test(phrase)) continue;
    return phrase;
  }

  return null;
}

/**
 * Search Finnhub for the real ticker of a company name.
 * Returns null if not found, single symbol if unambiguous, array if multiple.
 */
async function resolveCompanyTicker(
  apiKey: string,
  companyName: string,
): Promise<string | string[] | null> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/search?q=${encodeURIComponent(companyName)}&token=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.result || data.result.length === 0) return null;

    // Filter to common stock, ETF, ADR on US exchanges
    const relevant = (data.result as FinnhubSearchResult[]).filter(
      (r) => {
        const type = (r.type || '').toLowerCase();
        return type === 'common stock' || type === 'adr' || type === 'etf' || type === 'reit';
      },
    );

    if (relevant.length === 0) return null;
    if (relevant.length === 1) return relevant[0].symbol;

    // Multiple matches — return all for user selection
    return relevant.slice(0, 5).map(r => r.symbol);
  } catch {
    return null;
  }
}

/**
 * Validate a single marker's ticker against Finnhub profile.
 */
async function validateMarker(
  apiKey: string,
  symbol: string,
  contextName: string | null,
): Promise<{ issue: MarkerIssue | null }> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
    );
    if (!res.ok) return { issue: null };
    const profile: FinnhubProfile = await res.json();
    if (!profile.name) return { issue: null };

    const profileName = profile.name;

    // If we have context (company name from AI text), check if it matches
    if (contextName) {
      // Normalize: lowercase, strip "Inc.", "Corp.", "Ltd.", "PLC", "S.A.", etc.
      const normalize = (s: string) =>
        s.toLowerCase()
          .replace(/\b(?:inc\.?|corp\.?|corporation|ltd\.?|limited|plc|s\.?a\.?|ag|se|nv|bv|co\.?|company|holdings?|group|international|technologies?)\b/gi, '')
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

      const normCtx = normalize(contextName);
      const normProfile = normalize(profileName);

      // Check if profile name contains context name or vice versa
      const ctxWords = new Set(normCtx.split(' ').filter(w => w.length > 1));
      const profileWords = new Set(normProfile.split(' ').filter(w => w.length > 1));
      const overlap = [...ctxWords].filter(w => profileWords.has(w)).length;
      const minWords = Math.min(ctxWords.size, profileWords.size);

      if (overlap === 0 || (minWords > 0 && overlap / minWords < 0.5)) {
        // Mismatch! Try to find the correct ticker
        const correction = await resolveCompanyTicker(apiKey, contextName);
        return {
          issue: {
            suggested: symbol,
            contextName,
            correction,
            profileName,
          },
        };
      }
    }

    return { issue: null };
  } catch {
    return { issue: null };
  }
}

export interface ValidationResult {
  /** Corrected response text (markers replaced/augmented) */
  corrected: string;
  /** Issues found and resolved */
  issues: MarkerIssue[];
  /** Whether any markers were corrected */
  hasCorrections: boolean;
}

/**
 * Validate all RECOMMEND markers in an AI response.
 * Returns corrected text and list of issues.
 */
export async function validateRecommendationMarkers(
  responseText: string,
): Promise<ValidationResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { corrected: responseText, issues: [], hasCorrections: false };
  }

  // Extract all markers
  MARKER_REGEX.lastIndex = 0;
  const markers: Array<{ fullMatch: string; symbol: string; side: string; index: number }> = [];
  for (const match of responseText.matchAll(MARKER_REGEX)) {
    markers.push({
      fullMatch: match[0],
      symbol: match[1],
      side: match[2],
      index: match.index!,
    });
  }

  if (markers.length === 0) {
    return { corrected: responseText, issues: [], hasCorrections: false };
  }

  const issues: MarkerIssue[] = [];
  const replacements: Array<{ index: number; oldStr: string; newStr: string }> = [];

  for (const marker of markers) {
    const contextName = extractContextName(responseText, marker.symbol);
    const { issue } = await validateMarker(apiKey, marker.symbol, contextName);

    if (issue) {
      issues.push(issue);

      if (issue.correction) {
        if (Array.isArray(issue.correction)) {
          // Ambiguous — multiple possible tickers. Add a selection note.
          const options = issue.correction.map(s => `[RECOMMEND:${s}:${marker.side}]`).join(' or ');
          const display = issue.correction.map(s => {
            const dot = s === 'SKHYV' ? 'ADR' : s === '000660' ? 'KRX' : '';
            return dot ? `\`${s}\` (${dot})` : `\`${s}\``;
          }).join(', ');
          const note = `\n\n> ⚠️ **Which ${issue.contextName} symbol?** I found multiple: ${display}. Please confirm which one you want to trade.`;
          replacements.push({
            index: marker.index,
            oldStr: marker.fullMatch,
            newStr: options, // Replace with ALL options so user can pick any
          });
          // Also append the note
          // We'll handle this after the main replacement loop
        } else {
          // Single correction — replace wrong ticker with correct one
          const correctedMarker = `[RECOMMEND:${issue.correction}:${marker.side}]`;
          replacements.push({
            index: marker.index,
            oldStr: marker.fullMatch,
            newStr: correctedMarker,
          });
        }
      } else {
        // No correction found — strip the marker to prevent wrong trade
        replacements.push({
          index: marker.index,
          oldStr: marker.fullMatch,
          newStr: '', // Remove the marker (user sees just the ticker name)
        });
      }
    }
  }

  // Apply replacements (process in reverse order to preserve indices)
  let corrected = responseText;
  const appendNotes: string[] = [];
  for (const r of replacements.sort((a, b) => b.index - a.index)) {
    corrected = corrected.slice(0, r.index) + r.newStr + corrected.slice(r.index + r.oldStr.length);
  }

  // Append ambiguous-symbol notes if any
  if (appendNotes.length > 0) {
    corrected += '\n' + appendNotes.join('\n');
  }

  return {
    corrected,
    issues,
    hasCorrections: issues.length > 0,
  };
}
