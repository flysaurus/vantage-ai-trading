// ───────────────────────────────────────────────────────────────
// Message normalization — runs first, on every message, before any
// classification. Produces a canonical intent-bearing form so the
// classifier (and the narrow fast-path) never has to match surface
// text variations like "Build me portfolio" vs "Build me a portfolio".
// ───────────────────────────────────────────────────────────────

export interface NormalizedMessage {
  /** The original, untouched message. */
  original: string;
  /** Lowercased + collapsed whitespace. */
  lower: string;
  /** Meaningful tokens only (filler/articles stripped), lowercased. */
  tokens: string[];
  /** tokens joined with single spaces — the intent-bearing form. */
  compact: string;
  /** True when the message is empty or whitespace-only. */
  isEmpty: boolean;
  /** True when the message has no recognizable word content (gibberish). */
  isGibberish: boolean;
}

/**
 * Filler words that carry no intent signal. Stripping them lets
 * "build me a portfolio" and "build me portfolio" collapse to the same
 * intent-bearing form ("build portfolio"). Kept conservative so we never
 * strip a word that actually disambiguates meaning.
 */
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'some', 'my', 'our', 'me', 'please', 'pls', 'kindly',
  'just', 'could', 'would', 'can', 'you', 'i', 'we', 'to', 'for', 'of',
  'in', 'on', 'at', 'with', 'about', 'is', 'are', 'was', 'were', 'be',
  'do', 'does', 'did', 'your', 'it', 'that', 'this', 'and', 'or',
]);

/**
 * Normalize a raw message into its intent-bearing form.
 * - lowercase
 * - strip punctuation (keeps `$`, `.`, `-`, `&`, `/` for amounts/tickers)
 * - collapse whitespace
 * - tokenize and drop filler/articles
 */
export function normalizeMessage(message: string): NormalizedMessage {
  const raw = message ?? '';
  const lower = raw.toLowerCase().replace(/\s+/g, ' ').trim();

  // Keep $ amounts and . - / & (needed for tickers like BRK.B, amounts $1,000)
  const cleaned = lower.replace(/[^a-z0-9$\s.\-/&%]/g, ' ');

  const rawTokens = cleaned.split(/[\s,;:!?()[\]{}"']+/).filter(Boolean);
  const tokens: string[] = [];
  for (const t of rawTokens) {
    const bare = t.replace(/^[^a-z0-9$]+|[^a-z0-9$]+$/g, ''); // trim stray punctuation
    if (!bare) continue;
    // Keep numbers/amounts and ticker-ish tokens; drop pure filler words.
    if (FILLER_WORDS.has(bare)) continue;
    tokens.push(bare);
  }

  const compact = tokens.join(' ');
  const isEmpty = tokens.length === 0;

  // Gibberish heuristic: no alphabetic content of length ≥ 2, or a single
  // repeated character run, or too few recognizable tokens to mean anything.
  const hasWord = tokens.some((t) => /[a-z]{2,}/.test(t));
  const isGibberish = !isEmpty && (!hasWord || /^([^a-z0-9])\1+$/.test(compact));

  return { original: raw, lower, tokens, compact, isEmpty, isGibberish };
}

/**
 * Levenshtein edit distance — used for typo-tolerant ticker matching in the
 * fast-path (reuses the same approach proven in the ticker-resolver).
 */
export function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[bl];
}
