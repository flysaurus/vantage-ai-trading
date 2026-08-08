// ─── Trade Execution Gate ─────────────────────────────────────
// HARD BOUNDARY: re-verifies the symbol against Finnhub immediately
// before any real order fires. This is defense-in-depth — the
// primary defense is the merged symbol-resolution system, and this
// gate is the permanent last line that cannot be bypassed.
//
// Called from /api/broker/execute-trade before broker.placeOrder().
//
// Zero-tolerance: if the symbol doesn't match what the user was shown,
// the order is BLOCKED — not warned, not logged-and-continued.

interface FinnhubProfile {
  name: string;
  ticker: string;
  exchange: string;
}

interface GateResult {
  /** Whether the order is allowed to proceed */
  allowed: boolean;
  /** Human-readable reason for block (user-facing) */
  reason: string;
  /** Debug detail (logged, not shown to user) */
  detail?: string;
  /** Finnhub profile for the symbol (null if lookup failed) */
  profile?: FinnhubProfile | null;
}

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getApiKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

/**
 * Normalize a company name for comparison.
 * Strips legal suffixes, punctuation, extra whitespace.
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(?:inc\.?|corp\.?|corporation|ltd\.?|limited|plc|s\.?a\.?|ag|se|nv|bv|co\.?|company|holdings?|group|international|technologies?|therapeutics?|biosciences?|pharmaceuticals?)\b/gi,
      '',
    )
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Known alternative names for companies.
 * Maps colloquial / common names to the canonical names from Finnhub.
 * Prevents false-positive blocks when AI describes "Google" instead of "Alphabet".
 */
const COMPANY_ALIASES: Record<string, string[]> = {
  // Use lowercase keys matching normalized colloquial names
  google: ['alphabet'],
  alphabet: ['google'],
  facebook: ['meta platforms', 'meta'],
  'meta platforms': ['facebook'],
  meta: ['facebook'],
  alibaba: ['alibaba group holding'],
  baba: ['alibaba group holding'],
  // Add more as edge cases emerge
};

/**
 * Expand a normalized name with its known aliases for matching.
 */
function expandWithAliases(normalizedName: string): string[] {
  const results = [normalizedName];
  // Check if the whole name has aliases
  if (COMPANY_ALIASES[normalizedName]) {
    results.push(...COMPANY_ALIASES[normalizedName]);
  }
  // Also check each word individually
  for (const word of normalizedName.split(' ').filter(w => w.length > 1)) {
    if (COMPANY_ALIASES[word]) {
      results.push(...COMPANY_ALIASES[word]);
    }
  }
  return results;
}

/**
 * Check if two company names refer to the same entity.
 * Uses word overlap on normalized names, with alias expansion.
 */
function namesMatch(nameA: string, nameB: string): boolean {
  const normA = normalizeCompanyName(nameA);
  const normB = normalizeCompanyName(nameB);

  // Expand with known aliases
  const aliasesA = expandWithAliases(normA);
  const aliasesB = expandWithAliases(normB);

  // Try every combination — if any expanded alias pair matches, we're good
  for (const a of aliasesA) {
    for (const b of aliasesB) {
      // Direct match after normalization
      if (a === b) return true;

      // One contains the other
      if (a.includes(b) || b.includes(a)) return true;

      // Word overlap: at least 50% of the shorter name's words appear in the longer
      const wordsA = new Set(a.split(' ').filter(w => w.length > 1));
      const wordsB = new Set(b.split(' ').filter(w => w.length > 1));

      if (wordsA.size === 0 || wordsB.size === 0) continue;

      const shorter = wordsA.size <= wordsB.size ? wordsA : wordsB;
      const longer = wordsA.size > wordsB.size ? wordsA : wordsB;
      const overlap = [...shorter].filter(w => longer.has(w)).length;

      if (overlap / shorter.size >= 0.5) return true;
    }
  }

  return false;
}

/**
 * Fetch Finnhub company profile for a symbol.
 */
async function fetchProfile(symbol: string, apiKey: string): Promise<FinnhubProfile | null> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.name || !data.ticker) return null;
    return { name: data.name, ticker: data.ticker, exchange: data.exchange || '' };
  } catch {
    return null;
  }
}

// Regex for company names in text — matches capitalized multi-word names
// with common punctuation: letters, digits, spaces, ampersands, dots, commas,
// apostrophes, parentheses, and hyphens. GREEDY (no ?) so it captures full names.
const COMPANY_NAME_RE = /[A-Z][A-Za-z0-9 &.,'()-]{2,60}/;

/**
 * Extract company name context from a chat message for a given symbol.
 * Looks at text near the RECOMMEND marker for the company name the AI displayed.
 */
function extractContextFromMessage(messageContent: string, symbol: string): string | null {
  const escapedSym = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Find the RECOMMEND marker for this symbol
  const markerPattern = new RegExp(
    `\\[RECOMMEND:${escapedSym}:(BUY|SELL)(?::(?:\\$?\\d+(?:\\.\\d+)?))?\\]`,
    'gi',
  );

  const match = markerPattern.exec(messageContent);
  if (!match) return null;

  const markerStart = match.index;

  // Get text before the marker
  const beforeText = messageContent.slice(Math.max(0, markerStart - 300), markerStart);

  // Pattern 1: "**TICKER** - Company Name" or "**TICKER** — Company Name"
  const nameAfterDash = new RegExp(
    `\\*\\*${escapedSym}\\*\\*\\s*[-–—]\\s*(${COMPANY_NAME_RE.source})`,
    'i',
  );
  const dashMatch = nameAfterDash.exec(beforeText);
  if (dashMatch) {
    const name = dashMatch[1].trim();
    return name.replace(/[.,;:!]+$/, '').trim();
  }

  // Pattern 2: Company Name (TICKER)
  const nameWithTicker = new RegExp(
    `(${COMPANY_NAME_RE.source})\\s*\\(${escapedSym}\\)`,
    'i',
  );
  const tickerMatch = nameWithTicker.exec(beforeText);
  if (tickerMatch) {
    return tickerMatch[1].trim();
  }

  // Pattern 3: recommendation language followed by company name
  const recoMatch = beforeText.match(
    /(?:recommend|consider|suggest(?:ing)?|buy(?:ing)?|picking up)\s+(?:buying\s+)?(?:shares\s+(?:of|in)\s+)?([A-Z][\w &.,'()-]{3,60}?)(?:\s*\(|$)/i,
  );
  if (recoMatch) {
    return recoMatch[1].trim().replace(/[.,;:!]+$/, '').trim();
  }

  // Pattern 4: **Company Name** ($TICKER)
  const boldName = new RegExp(
    `\\*\\*(${COMPANY_NAME_RE.source})\\*\\*\\s*\\(\\$?${escapedSym}\\)`,
    'i',
  );
  const boldMatch = boldName.exec(beforeText);
  if (boldMatch) {
    return boldMatch[1].trim();
  }

  // Fallback: grab trailing capitalized words (last 1-4 words)
  const words = beforeText.split(/\s+/);
  const isCapitalized = (w: string) =>
    /^[A-Z]{2,5}(?:[.&]?[A-Z]{0,5})*$/.test(w) ||
    /^[A-Z][a-z]{2,}$/.test(w);

  const nameWords: string[] = [];
  for (let i = words.length - 1; i >= 0 && nameWords.length < 4; i--) {
    const w = words[i];
    if (isCapitalized(w)) {
      nameWords.unshift(w);
    } else if (nameWords.length > 0) {
      break;
    }
  }

  const candidate = nameWords.join(' ');
  const blockedWords = /^(?:The|This|That|Buy|Sell|Hold|We|You|It|At|In|On|By|To|Or|And|But|So|If|As|Is|Be|Are|Was|Were|Will|Can|Should|Would|Could|Do|Does|Did|Has|Have|From|Into|Over|Under|Up|Out|Off|Down|Back)$/i;
  if (candidate.length > 0 && !blockedWords.test(candidate)) {
    return candidate;
  }

  return null;
}

/**
 * Hard boundary check before placing a real order.
 *
 * Blocks the order if:
 * 1. The symbol is not a known/valid ticker in Finnhub
 * 2. The company name shown to the user doesn't match Finnhub's
 *    authoritative name for that symbol
 *
 * This is the LAST line of defense. It should be kept permanently
 * even after the symbol-resolution merge makes it redundant.
 */
export async function verifyTradeSymbol(
  symbol: string,
  messageId?: string | null,
  supabase?: any,
  /** Company name the AI displayed — if provided, used directly instead of regex extraction */
  expectedCompanyName?: string | null,
): Promise<GateResult> {
  const apiKey = getApiKey();

  // ── Gate 0: No Finnhub key — allow but log ──
  if (!apiKey) {
    console.error('[trade-gate] No Finnhub API key — gate is DISABLED');
    return { allowed: true, reason: 'Gate disabled (no API key)', detail: 'FINNHUB_IO_API_KEY not set' };
  }

  // ── Gate 1: Symbol validity ──
  const profile = await fetchProfile(symbol, apiKey);
  if (!profile) {
    return {
      allowed: false,
      reason: `"${symbol.toUpperCase()}" is not a recognized ticker symbol. The order was blocked as a safety measure.`,
      detail: `Finnhub profile2 returned no data for ${symbol}`,
      profile: null,
    };
  }

  // ── Gate 2: Company name match ──
  // Priority: explicit expectedCompanyName > message extraction > skip

  // Path A: Direct company name passed from client — most reliable
  if (expectedCompanyName) {
    const match = namesMatch(expectedCompanyName, profile.name);
    if (!match) {
      console.error(
        `[trade-gate] BLOCKED: Symbol ${symbol} mismatch (direct pass)!\n` +
        `  Expected: "${expectedCompanyName}"\n` +
        `  Finnhub:  "${profile.name}" (${profile.ticker}, ${profile.exchange})`,
      );
      return {
        allowed: false,
        reason: [
          `**Order blocked** — safety check failed.`,
          ``,
          `The symbol **${symbol.toUpperCase()}** (${profile.name}) does not match ` +
          `what was shown in the chat ("${expectedCompanyName}").`,
          ``,
          `This prevents buying the wrong stock if the AI misidentified a company. ` +
          `The order was **not** submitted. No money moved.`,
          ``,
          `You can still place this trade manually from the Invest tab if you're sure.`,
        ].join('\n'),
        detail: `direct: "${expectedCompanyName}" vs profile "${profile.name}" — mismatch`,
        profile,
      };
    }
    console.log(
      `[trade-gate] VERIFIED: ${symbol} — "${expectedCompanyName}" matches Finnhub "${profile.name}" (direct)`,
    );
    return {
      allowed: true,
      reason: `Verified: ${symbol} matches "${profile.name}"`,
      profile,
    };
  }

  // Path B: Extract from chat message (needs messageId + supabase)
  if (!messageId || !supabase) {
    return {
      allowed: true,
      reason: 'Symbol verified (no AI context to cross-check)',
      profile,
    };
  }

  try {
    // Fetch the chat message
    const { data: messageRow, error: msgError } = await supabase
      .from('chat_messages')
      .select('content, role')
      .eq('id', messageId)
      .single();

    if (msgError || !messageRow) {
      console.warn(`[trade-gate] Could not fetch message ${messageId}:`, msgError?.message);
      return {
        allowed: true,
        reason: 'Symbol verified (message context unavailable for cross-check)',
        profile,
        detail: `message fetch failed: ${msgError?.message || 'not found'}`,
      };
    }

    // Only verify assistant messages
    if (messageRow.role !== 'assistant') {
      return {
        allowed: true,
        reason: 'Symbol verified (manual trade, not AI-generated)',
        profile,
      };
    }

    // Extract the company name — prefer the explicitly-passed name from the client,
    // fall back to regex extraction from the message content
    const contextName = expectedCompanyName || extractContextFromMessage(messageRow.content, symbol);

    if (!contextName) {
      console.warn(
        `[trade-gate] No company name context found in message ${messageId} ` +
        `for symbol ${symbol}. Order allowed (symbol valid), cross-check skipped.`,
      );
      return {
        allowed: true,
        reason: 'Symbol verified (no company-name context to cross-check)',
        profile,
        detail: 'extractContextFromMessage returned null',
      };
    }

    // ── THE HARD CHECK ──
    const match = namesMatch(contextName, profile.name);

    if (!match) {
      console.error(
        `[trade-gate] BLOCKED: Symbol ${symbol} mismatch!\n` +
        `  Message context: "${contextName}"\n` +
        `  Finnhub profile: "${profile.name}" (${profile.ticker}, ${profile.exchange})\n` +
        `  Message ID: ${messageId}`,
      );
      return {
        allowed: false,
        reason: [
          `**Order blocked** — safety check failed.`,
          ``,
          `The symbol **${symbol.toUpperCase()}** (${profile.name}) does not match ` +
          `what was shown in the chat ("${contextName}").`,
          ``,
          `This prevents buying the wrong stock if the AI misidentified a company. ` +
          `The order was **not** submitted. No money moved.`,
          ``,
          `You can still place this trade manually from the Invest tab if you're sure.`,
        ].join('\n'),
        detail: `context="${contextName}" vs profile="${profile.name}" — word-overlap check failed`,
        profile,
      };
    }

    // All gates passed
    console.log(
      `[trade-gate] VERIFIED: ${symbol} — "${contextName}" matches Finnhub "${profile.name}"`,
    );
    return {
      allowed: true,
      reason: `Verified: ${symbol} matches "${profile.name}"`,
      profile,
    };
  } catch (err: any) {
    // Gate infrastructure error — fail-closed. Zero tolerance.
    console.error(`[trade-gate] Gate infrastructure error:`, err.message);
    return {
      allowed: false,
      reason: [
        `**Order blocked** — the safety verification system encountered an error.`,
        ``,
        `This is a temporary issue, not a problem with your order. Please try again ` +
        `in a moment, or place the trade manually from the Invest tab.`,
      ].join('\n'),
      detail: `infrastructure error: ${err.message}`,
    };
  }
}
