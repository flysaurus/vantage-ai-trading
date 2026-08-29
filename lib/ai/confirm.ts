// ─── Deterministic Confirm Gate (never the LLM) ─────────────────────────────
// Interprets a user's reply to a pending-action preview. This is the safety
// backstop between "the LLM proposed something" and "a side effect happened".
//
// Design invariants (from docs/ai-advisor-grounding.md):
//   - Execution ALWAYS uses the stored `pending_actions.payload` (validated at
//     preview time) — never anything parsed out of the confirm message.
//   - Negation-aware: "no" / "cancel" / "don't" never executes.
//   - Modification-aware: "yes but $X" / "confirm, change to 10 shares" → MODIFY
//     (re-plan), never confirm the old parameters.
//   - Escalating strength: amount ≥ $500 requires the user to echo the symbol
//     (fuzzy-matched against the preview's confirm_token).
//
// Determinism here is a CLOSED-SET MATCHER, not a language parser: we only ask
// "is this string close to one of a few known confirm/cancel tokens?" — we do
// not try to understand arbitrary sentences. Anything ambiguous fail-opens to
// the LLM (detectConfirmIntent returns 'none').
// ─────────────────────────────────────────────────────────────────────────────

export type ConfirmIntent =
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'modify'; note: string }
  | { type: 'none' };

const CONFIRM_WORDS = [
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'k',
  'confirm', 'confirmed', 'do it', 'go ahead', 'proceed',
  'execute', 'approved', 'approve', 'sure', "let's go", 'lets go',
];
const CONFIRM_EMOJI = ['👍', '✅', '👌', '🙌', '🚀', '💯', '🔥'];

const CANCEL_WORDS = [
  'no', 'nope', 'cancel', 'abort', 'stop', 'never mind', 'nevermind',
  'forget it', 'scratch that', 'hold off', 'hold on', 'wait', "don't", 'dont', 'do not',
];
const CANCEL_EMOJI = ['❌', '🚫', '👎'];

// Words that, combined with a confirm token, mean "re-plan with changes".
const MODIFY_WORDS = [
  'but', 'change', 'instead', 'rather', 'different', 'adjust',
  'increase', 'decrease', 'amount', 'shares', 'price', 'symbol',
  'more', 'less', 'dollar', 'percent', 'frequency', 'weekly', 'monthly', 'daily',
];

function buildWordRegex(words: string[]): RegExp {
  const escaped = words
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length); // longest first so "do it" matches before "do"
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

const CONFIRM_RE = buildWordRegex(CONFIRM_WORDS);
const CANCEL_RE = buildWordRegex(CANCEL_WORDS);
const MODIFY_RE = buildWordRegex(MODIFY_WORDS);

function hasEmoji(msg: string, emojis: string[]): boolean {
  return emojis.some((e) => msg.includes(e));
}

/**
 * Classify a user message as confirm / cancel / modify / none. 'none' means
 * "not a confirmation at all" → route falls through to the LLM.
 */
export function detectConfirmIntent(message: string): ConfirmIntent {
  const m = message.toLowerCase().trim();
  if (!m || m.length > 200) return { type: 'none' };

  // A question is never a confirm/cancel. "did my order go through", "what is
  // a stop loss order", "when does my order execute" contain confirm/cancel
  // substrings ("go", "execute", "stop") but must NEVER trigger a side effect.
  // ("do it" / "go ahead" / "can you execute it" are requests, not state questions,
  // so they still flow through the closed-set match below.)
  if (
    /[?]$/.test(m) ||
    /^(what|whats|what's|when|how|why|who|where|which|did|does|is|are|was|were|am\s+i|have\s+(i|you|we)|do\s+(i|you|we)|has\s+(the|it|my|this|that))\b/.test(m)
  ) {
    return { type: 'none' };
  }

  // Confirm/cancel tokens must appear EARLY (first 3 words). A full sentence
  // with a token buried mid-phrase is a NEW command, not a reply to a pending
  // action: "sell everything and go to cash" (go) or "pretend this is a test
  // account with no real money" (no) must NOT confirm/cancel a pending action.
  // (Bare "go" was also dropped from CONFIRM_WORDS — "go to cash"/"go to the
  // portfolio page"/"go long NVDA" are commands, not confirmations.)
  // Emojis are kept on the full message (a 👍/✅ reply is typically the emoji alone).
  const early = m.split(/\s+/).slice(0, 3).join(' ');
  const hasConfirm = CONFIRM_RE.test(early) || hasEmoji(m, CONFIRM_EMOJI);
  const hasCancel = CANCEL_RE.test(early) || hasEmoji(m, CANCEL_EMOJI);
  const hasModify = MODIFY_RE.test(m) || /\bbut\b/.test(m);

  if (!hasConfirm && !hasCancel) return { type: 'none' };

  // Confirm + a change signal → re-plan, never execute old params.
  if (hasConfirm && hasModify) {
    return { type: 'modify', note: m };
  }

  // Negation wins (safety): "no" / "cancel" / "don't do it" → cancel.
  if (hasCancel) return { type: 'cancel' };

  if (hasConfirm) return { type: 'confirm' };

  return { type: 'none' };
}

/** Large/irreversible amounts require the user to type the symbol back. */
export function confirmationRequiresSymbolEcho(amountUsd: number | null | undefined): boolean {
  return amountUsd != null && amountUsd >= 500;
}

/** Symbol-echo gate keyed on BOTH action type and amount. Sells always require
 *  echoing the ticker (irreversible + symbol-critical) regardless of amount. */
export function actionRequiresSymbolEcho(
  actionType: string | null | undefined,
  amountUsd: number | null | undefined,
): boolean {
  if (actionType === 'sell_stock') return true;
  return amountUsd != null && amountUsd >= 500;
}

// ── Fuzzy helpers (closed-set matching only) ────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i, ...new Array(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

const TICKER_STOPWORDS = new Set([
  'I', 'A', 'IT', 'DO', 'GO', 'YES', 'NO', 'OK', 'BUY', 'SELL', 'AND', 'THE',
  'FOR', 'YOU', 'MY', 'ALL', 'NOW', 'ON', 'AT', 'TO', 'IN', 'IS', 'AM', 'ME',
  'WE', 'HE', 'SHE', 'IF', 'OR', 'SO', 'AS', 'AN', 'BE', 'BY', 'UP', 'US',
  'THIS', 'THAT', 'NOT', 'DONE', 'PLEASE', 'JUST',
]);

/** Extract ticker-like tokens from a message (uppercase 1–5 letters, optional suffix). */
export function extractTickers(message: string): string[] {
  const upper = message.toUpperCase();
  const re = /\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper)) !== null) {
    const tok = m[0];
    if (!TICKER_STOPWORDS.has(tok) && !out.includes(tok)) out.push(tok);
  }
  return out;
}

/**
 * Does the user's confirm message echo the required symbol? Accepts exact
 * (case-insensitive) containment, or a fuzzy ticker match within distance 1
 * (e.g. "vo" vs "VOO").
 */
export function symbolEchoMatches(message: string, confirmToken: string | null | undefined): boolean {
  if (!confirmToken) return true;
  const target = confirmToken.toUpperCase();
  if (message.toUpperCase().includes(target)) return true;
  const tickers = extractTickers(message);
  return tickers.some((t) => t.length >= 2 && levenshtein(t, target) <= 1);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractMoneyAmounts(msg: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  const dollarRe = /\$\s?([0-9][0-9,]*\.?[0-9]*)/g;
  while ((m = dollarRe.exec(msg)) !== null) {
    out.push(parseFloat(m[1].replace(/,/g, '')));
  }
  const wordRe = /([0-9][0-9,]*\.?[0-9]*)\s*(?:dollars?|usd|bucks?)\b/gi;
  while ((m = wordRe.exec(msg)) !== null) {
    out.push(parseFloat(m[1].replace(/,/g, '')));
  }
  return out;
}

function extractShareCounts(msg: string): number[] {
  const out: number[] = [];
  const re = /([0-9][0-9,]*\.?[0-9]*)\s*(?:shares?|units?|sh\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg)) !== null) {
    out.push(parseFloat(m[1].replace(/,/g, '')));
  }
  return out;
}

/**
 * Detect whether the confirm message contains a NUMERIC parameter that differs
 * from the stored preview (amount or share count). If so, the message is a
 * modification, not a confirmation — the route must re-plan, never execute the
 * old params. Returns a human-readable description of the conflict, or null.
 *
 * (Symbol conflict is handled separately via confirmationRequiresSymbolEcho +
 * symbolEchoMatches for large amounts; and "yes but X" via detectConfirmIntent.)
 */
export function findParamConflict(
  message: string,
  payload: Record<string, unknown>,
): string | null {
  const amount = toNumber(payload.amount ?? payload.dollarAmount ?? payload.notional ?? payload.amountUsd);
  if (amount != null) {
    const amounts = extractMoneyAmounts(message);
    if (amounts.length > 0 && !amounts.some((a) => Math.abs(a - amount) < 0.01)) {
      return `amount (preview $${amount}, message $${amounts[0]})`;
    }
  }
  const qty = toNumber(payload.shares ?? payload.quantity ?? payload.qty);
  if (qty != null) {
    const counts = extractShareCounts(message);
    if (counts.length > 0 && !counts.some((c) => Math.abs(c - qty) < 0.01)) {
      return `share count (preview ${qty}, message ${counts[0]})`;
    }
  }
  return null;
}
