// ─── Post-generation response guards ────────────────────────────────────────
// Deterministic, pure helpers that back the prompt-only rules with code-level
// enforcement. No server-only imports, no new dependencies — safe to unit test
// and to compose anywhere in the pipeline.
//
//   a. detectHoldingsCountMismatch  — fabricated position counts
//   b. detectProjectedScoreClaim    — invented projected/illustrative scores
//   c. suppressProjectedScores      — deterministic strip of a projection phrase
//   d. enforceTierLimits            — literacy-tier word/section budget
//   e. shouldAttachHealthChart      — deterministic health-subscores chart gate
//   f. suppressWithheldValueClaims  — prose that states a withheld/unknown value as fact
// ────────────────────────────────────────────────────────────────────────────

const NUMBERISH_RE = /[\d$%]/
/** An ALL-CAPS token (2–5 letters) is treated as a ticker — protect it. */
const TICKER_RE = /\b[A-Z]{2,5}\b/

// ── (a) Holdings-count mismatch ─────────────────────────────────────────────
/**
 * Detect a bare TOTAL holdings count that contradicts the authoritative position
 * count. Only fires when actualCount > 0 and the claim is >5% off. Qualified
 * claims ("top 10 holdings", "your 5 largest positions", "10 of your …") are
 * skipped — those are legitimately subsets, not totals.
 *
 * Returns a user-facing correction suffix, or null when grounded/unknown.
 */
export function detectHoldingsCountMismatch(text: string, actualCount: number): string | null {
  if (!text || !Number.isFinite(actualCount) || actualCount <= 0) return null
  const re = /\b(\d[\d,]{0,6})\s+(holdings|positions|stocks|securities)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const claimed = parseInt(m[1].replace(/,/g, ''), 10)
    if (!Number.isFinite(claimed) || claimed <= 0) continue

    // Skip qualified claims: "top 10 holdings", "your 5 largest positions", …
    // ALSO skip TARGET/intent counts ("consolidate to 30-40 positions",
    // "trim down to 20 holdings") — those are goals, not claims of what is held.
    const before = text.slice(Math.max(0, m.index - 48), m.index)
    if (/(?:\btop|\blargest|\bbiggest|\bmajor|\bfirst|\blast|\bnext|\bfew|\bseveral|\bremaining|\bother|\bto|\binto|\btoward|\btarget(?:ing)?|\baim(?:ing)?|\bgoal|\btrim|\bcut|\bconsolidat\w*|\breduce|\bbelow|\bunder|\babout|\baround|\broughly|\bmax(?:imum)?|\bfewer|\blimit|\b~)\s*$/i.test(before)) continue
    // "Your target is 40 holdings", "the goal is 30 positions" — goals, not facts.
    if (/\b(?:target|goal|aim|objective|plan|intention|strategy)\b[^.]{0,24}$/i.test(before)) continue
    // Skip ranges: "30-40 positions" (upper bound) and "30-40" (lower bound).
    if (/[-–—]\s*$/.test(before)) continue
    if (/^\s*[-–—]\s*\d/.test(text.slice(m.index + m[1].length, m.index + m[1].length + 4))) continue
    // Skip "N of your …" / "N individual …" phrasings (belt & braces).
    const after = text.slice(m.index, m.index + m[0].length + 16)
    if (/\d[\d,]*\s+(?:of\s+your|individual)\b/i.test(after)) continue

    const diff = Math.abs(claimed - actualCount) / actualCount
    if (diff > 0.05) {
      return `\n\n---\n⚠️ *Correction: you hold ${actualCount} positions, not ${claimed}.*`
    }
  }
  return null
}

// ── (b) Projected/illustrative score claims ─────────────────────────────────
// The model must never invent a forward-looking score ("would push this to
// 98–99", "would move the score from 91 to 92–94", "To break 85 on Returns",
// "worth +2–3 points"). These are projections dressed as facts. Real, labelled
// figures ("health score of 91/100", "Diversification 94") contain no projection
// verb, so they never fire.
// Market/price talk looks identical to a score projection in shape ("NVDA could
// climb 8%", "the S&P could hit 6000"). Any of these markers in the surrounding
// window means we are NOT looking at an invented health score — skip it.
const MARKET_CONTEXT_RE =
  /S&P|Nasdaq|Dow\b|Russell|\bprice\b|\bstock\b|\bshares?\b|\bmarket\b|\bindex\b|\beps\b|\brevenue\b|\byield\b|\bdividend\b|\bpct\b|\bquarter\b|\bearnings\b|\bguide(?:ance)?\b/i
const hasMarketContext = (text: string, start: number, end: number) => {
  // "%" / "$" only count when attached to THIS number ("climb 8%"), not when a
  // stray percentage from a neighbouring clause sits nearby.
  if (/[%$]/.test(text.slice(Math.max(0, start - 6), Math.min(text.length, end + 3)))) return true
  // Deliberately TIGHT: a "price" or "S&P" from an unrelated earlier clause must
  // not excuse a score projection.
  const win = text.slice(Math.max(0, start - 30), Math.min(text.length, end + 15))
  return MARKET_CONTEXT_RE.test(win)
}

/** Health/score vocabulary — required for the broad, modal-less projection rules. */
const SCORE_CONTEXT_RE = /\b(?:score|sub-?scores?|Returns|Diversification|Risk\s*[Bb]alance|health)\b/i
const hasScoreContext = (text: string, start: number, end: number) =>
  SCORE_CONTEXT_RE.test(text.slice(Math.max(0, start - 120), Math.min(text.length, end + 120)))

const PROJECTION_VERB = 'push\\w*|mov\\w*|lift\\w*|rais\\w*|bring\\w*|boost\\w*|jump\\w*|break\\w*|reach\\w*|ris(?:e|es|en|ing)|climb\\w*|improv\\w*|tak(?:e|es|en|ing)|shift\\w*|drag\\w*|consolidat\\w*|driv(?:e|es|en|ing)|help\\w*|lead\\w*|get\\w*'

/** `skipOnMarketContext` protects price/market talk ("could climb 8%", "S&P could
 * hit 6000"). `requireScoreContext` is for the broad, modal-less rules — a verb or
 * an arrow next to a small number is only a fabricated score when the surrounding
 * text is actually talking about the score/sub-scores.
 */
type ProjectionRule = {
  re: RegExp
  skipOnMarketContext?: boolean
  requireScoreContext?: boolean
}
const PROJECTION_RES: ProjectionRule[] = [
  // would/could push|move|bump|… {this|it|the score} … to <n>[-<n>]
  // The object requirement separates a SCORE projection ("would push this to
  // 98–99") from a price target ("SPY could move to 6200").
  {
    re: /\b(?:would|could|should|might|may)\s+(?:push|move|bump|lift|take|bring|raise|drag|nudge)\s+(?:this|it|that|them|the\s+score|your\s+score|the\s+number|the\s+reading)\b[^.!?\n]{0,40}?\bto\s+\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?\+?/i,
    skipOnMarketContext: true,
  },
  // would/could rise|climb|reach|hit|exceed|break|gain … <n>[-<n>]
  {
    re: /\b(?:would|could|should|might|may)\s+(?:rise|climb|increase|improve|go|jump|reach|hit|exceed|break|gain)\b[^.!?\n]{0,40}?\b\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?/i,
    skipOnMarketContext: true,
  },
  // "To break 85 on Returns"
  { re: /\bto\s+break\s+\d{1,3}\b/i, skipOnMarketContext: true },
  // "from 91 to 94+", "from 95+ territory to 91" — before/after score framing
  { re: /\bfrom\s+\d{1,3}\+?[^.\n]{0,20}?\bto\s+\d{1,3}\+?/i, skipOnMarketContext: true, requireScoreContext: true },
  // Arrow pairs: "Returns 78 → 85+" (no modal verb needed; arrows are never data here)
  { re: /\b\d{1,3}\s*(?:→|->)\s*\d{1,3}\+?/, skipOnMarketContext: true },
  // Modal-less projection verbs next to a small number, in score context:
  // "watch your score jump from 91", "would lift the 91 → 95+",
  // "pushing your total score to 93-94" (stems so -ing forms match too)
  {
    re: new RegExp(`\\b(?:${PROJECTION_VERB})[^.!?\\n]{0,45}?\\b\\d{1,3}(?:\\s*(?:\\+|-|–|—|%))?`, 'i'),
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "closer to 85-88", "toward 90+"
  {
    re: /\b(?:closer\s+to|toward|towards)\s+\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\+?/i,
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "stay 95+", "remain above 90"
  {
    re: /\b(?:stay|stays|remain|remains)\s+[^.!?\n]{0,10}?\d{2,3}\+/i,
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "keep Diversification at 90+", "hold it at 90+"
  {
    re: /\b(?:keep|keeps|hold|holds)\s+[^.!?\n]{0,20}?\b(?:at|to)\s+\d{2,3}\+/i,
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "worth +2–3 points"
  { re: /\bworth\s*\+?\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?\s*points?\b/i, skipOnMarketContext: false },
  // bare "+2–3 points"
  { re: /\+?\d{1,3}\s*[–\-—]\s*\d{1,3}\s*points?\b/i, skipOnMarketContext: false },
]

/** "…40-50 positions", "…30 names" — a target COUNT, not a projected score. */
const isCountPhrase = (text: string, end: number) =>
  /^[\s\d\-\u2013\u2014to]{0,12}(?:holdings|positions|stocks|securities|names|plays|tickers)\b/i.test(
    text.slice(end, end + 24),
  )

/**
 * Returns the offending projection phrase when the text makes an INVENTED
 * projected/illustrative score claim, else null.
 */
export function detectProjectedScoreClaim(text: string): string | null {
  if (!text) return null
  for (const { re, skipOnMarketContext, requireScoreContext } of PROJECTION_RES) {
    // Scan EVERY match of the rule — a skipped first match (count phrase, market
    // talk) must not blind the rule to a genuine projection later in the text.
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    let m: RegExpExecArray | null
    while ((m = g.exec(text)) !== null) {
      if (m[0].length === 0) {
        g.lastIndex++
        continue
      }
      if (isCountPhrase(text, m.index + m[0].length)) continue
      if (skipOnMarketContext && hasMarketContext(text, m.index, m.index + m[0].length)) continue
      if (requireScoreContext && !hasScoreContext(text, m.index, m.index + m[0].length)) continue
      return m[0].trim()
    }
  }
  return null
}

// ── (c) Deterministic suppression fallback ──────────────────────────────────
// When regeneration didn't remove the projection (retry exhausted), strip the
// numeric projection phrase — including a leading "to" / "from X to" — leaving a
// grammatical sentence behind. Counts removals.
const SUPPRESS_RULES: ProjectionRule[] = [
  // would/could … {this|it|the score} … from X to Y[-Z]
  {
    re: /\s*\b(?:would|could|should|might|may)\s+(?:push|move|bump|lift|take|bring|raise|drag|nudge)\s+(?:this|it|that|them|the\s+score|your\s+score|the\s+number|the\s+reading)\b[^.!?\n]{0,40}?\bfrom\s+\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?\s+to\s+\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?/gi,
    skipOnMarketContext: true,
  },
  // would/could … {this|it|the score} … to Y[-Z]
  {
    re: /\s*\b(?:would|could|should|might|may)\s+(?:push|move|bump|lift|take|bring|raise|drag|nudge)\s+(?:this|it|that|them|the\s+score|your\s+score|the\s+number|the\s+reading)\b[^.!?\n]{0,40}?\bto\s+\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?\+?/gi,
    skipOnMarketContext: true,
  },
  // would/could rise|climb|reach|… Y[-Z]
  {
    re: /\s*\b(?:would|could|should|might|may)\s+(?:rise|climb|increase|improve|go|jump|reach|hit|exceed|break|gain)\b[^.!?\n]{0,40}?\b\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?/gi,
    skipOnMarketContext: true,
  },
  // "to break N"
  { re: /\s*\bto\s+break\s+\d{1,3}\b/gi, skipOnMarketContext: true },
  // "from N to M"
  {
    re: /\s*\bfrom\s+\d{1,3}\+?[^.\n]{0,20}?\bto\s+\d{1,3}\+?/gi,
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // Arrow pairs "78 → 85+"
  { re: /\s*\b\d{1,3}\s*(?:→|->)\s*\d{1,3}\+?/gi, skipOnMarketContext: true },
  // Modal-less projection verbs in score context
  {
    re: new RegExp(`\\s*\\b(?:${PROJECTION_VERB})[^.!?\\n]{0,45}?\\b\\d{1,3}(?:\\s*(?:\\+|-|–|—|%))?`, 'gi'),
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "closer to 85-88", "toward 90+"
  {
    re: /\s*\b(?:closer\s+to|toward|towards)\s+\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\+?/gi,
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "stay 95+"
  {
    re: /\s*\b(?:stay|stays|remain|remains)\s+[^.!?\n]{0,10}?\d{2,3}\+/gi,
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "keep Diversification at 90+"
  {
    re: /\s*\b(?:keep|keeps|hold|holds)\s+[^.!?\n]{0,20}?\b(?:at|to)\s+\d{2,3}\+/gi,
    skipOnMarketContext: true,
    requireScoreContext: true,
  },
  // "worth +2–3 points"
  { re: /\s*\bworth\s*\+?\d{1,3}(?:\s*[–\-—]\s*\d{1,3})?\s*points?\b/gi, skipOnMarketContext: false },
  // bare "+2–3 points"
  { re: /\s*\+?\d{1,3}\s*[–\-—]\s*\d{1,3}\s*points?\b/gi, skipOnMarketContext: false },
]

export function suppressProjectedScores(text: string): { text: string; removed: number } {
  if (!text) return { text, removed: 0 }
  let removed = 0
  let out = text
  for (const { re, skipOnMarketContext, requireScoreContext } of SUPPRESS_RULES) {
    out = out.replace(re, (match: string, ...rest: unknown[]) => {
      // Market/price talk is preserved, not stripped.
      const offset = typeof rest[rest.length - 2] === 'number' ? (rest[rest.length - 2] as number) : 0
      const whole = rest[rest.length - 1] as string
      if (isCountPhrase(whole, offset + match.length)) return match
      if (skipOnMarketContext && hasMarketContext(whole, offset, offset + match.length)) return match
      if (requireScoreContext && !hasScoreContext(whole, offset, offset + match.length)) return match
      removed++
      return ''
    })
  }
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '')
  return { text: out, removed }
}

// ── (d) Literacy-tier limits ────────────────────────────────────────────────
const TIER_BUDGETS: Record<string, { words: number; sections: number }> = {
  experienced: { words: 150, sections: 4 },
  'some-experience': { words: 350, sections: 6 },
  new: { words: 450, sections: 6 },
}
// The literacy question is deliberately skippable, so NULL is a COMMON real-user
// state, not an edge case. An unbounded NULL tier left the original complaint
// (very long, chart-less responses) live for every user who skipped onboarding.
const DEFAULT_TIER: keyof typeof TIER_BUDGETS = 'some-experience'
const DEFAULT_TIER_BUDGET = TIER_BUDGETS[DEFAULT_TIER]

const isTableLine = (l: string) => /^\s*\|/.test(l)
const isMarkerOnlyLine = (l: string) => /^\s*\[[^\]]*\]\s*$/.test(l)
const isHeadingLine = (l: string) => /^\s*#{1,6}\s+\S/.test(l)
const isBoldOnlyLine = (l: string) => /^\s*\*\*[^*].*\*\*\s*$/.test(l)
const isSectionLine = (l: string) =>
  isHeadingLine(l) || isBoldOnlyLine(l) || (/^\s*\*\*/.test(l) && /\*\*\s*$/.test(l))
const isTldrLine = (l: string) => /TL;DR/i.test(l)
const wordsOf = (l: string) => l.trim().split(/\s+/).filter(Boolean).length
/** Prose = everything that is NOT a table row, marker-only line, or section head. */
const isProseLine = (l: string) =>
  l.trim() !== '' && !isTableLine(l) && !isMarkerOnlyLine(l) && !isSectionLine(l)

/**
 * Enforce the literacy-tier response budget.
 *   experienced      → 150 prose words, max 4 sections
 *   some-experience  → 350 prose words, max 6 sections
 *   anything else / null → never trimmed (returned unchanged).
 *
 * Trimming is CONSERVATIVE and driven from the end: whole digit/`$`/`%`/ticker-free
 * sentences are removed until within the word budget; then trailing sections whose
 * content carries no numbers are dropped until within the section cap. The TL;DR
 * line and every number are NEVER removed.
 */
export function enforceTierLimits(
  text: string,
  tier: string | null | undefined,
): { text: string; trimmedWords: number; droppedSections: number; overBudget: boolean; tier: string } {
  const key = String(tier ?? '').trim().toLowerCase()
  // Unknown or missing tier → the default budget. There is deliberately NO
  // unbounded path: a NULL/absent tier must not mean "no cap at all".
  const appliedTier = TIER_BUDGETS[key] ? key : DEFAULT_TIER
  const budget = TIER_BUDGETS[appliedTier]
  if (!text || !budget) {
    return { text, trimmedWords: 0, droppedSections: 0, overBudget: false, tier: appliedTier }
  }

  const lines = text.split('\n')
  const countProse = () =>
    lines.reduce((n, l) => n + (isProseLine(l) ? wordsOf(l) : 0), 0)
  const countSections = () => lines.filter(isSectionLine).length

  const startProse = countProse()
  const startSections = countSections()
  const overBudget = startProse > budget.words || startSections > budget.sections

  const floor = 40 // never trim the response below this many prose words

  // ── 1. Trim digit-free sentences, working back from the end ──
  // Sentences carrying a number/$/% or an ALL-CAPS ticker are NEVER removed, but
  // they no longer stop the trim: the guard skips them and keeps looking further
  // back, so a trailing "keep the 6% buffer" sentence can't block every trim.
  let guard = 0
  while (countProse() > budget.words && countProse() > floor && guard++ < 500) {
    let removed = false
    for (let i = lines.length - 1; i >= 0 && !removed; i--) {
      if (!isProseLine(lines[i]) || isTldrLine(lines[i])) continue
      const sentences = lines[i].split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '')
      let target = -1
      for (let j = sentences.length - 1; j >= 0; j--) {
        const sentence = sentences[j]
        if (NUMBERISH_RE.test(sentence) || TICKER_RE.test(sentence)) continue
        if (countProse() - wordsOf(sentence) < floor) break
        target = j
        break
      }
      if (target === -1) continue
      sentences.splice(target, 1)
      if (sentences.length === 0) lines.splice(i, 1)
      else lines[i] = sentences.join(' ')
      removed = true
    }
    if (!removed) break
  }

  // ── 2. Drop trailing sections whose content carries no digits/$/% ──
  guard = 0
  while (countSections() > budget.sections && countSections() > 1 && guard++ < 100) {
    let secIdx = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (isSectionLine(lines[i])) {
        secIdx = i
        break
      }
    }
    if (secIdx === -1) break
    // content = lines after the head up to the next section head
    let end = lines.length
    for (let i = secIdx + 1; i < lines.length; i++) {
      if (isSectionLine(lines[i])) {
        end = i
        break
      }
    }
    const content = lines.slice(secIdx, end).join('\n')
    if (NUMBERISH_RE.test(content) || isTldrLine(content)) break
    lines.splice(secIdx, end - secIdx)
  }

  const finalProse = countProse()
  const finalSections = countSections()
  return {
    text: lines.join('\n'),
    trimmedWords: Math.max(0, startProse - finalProse),
    droppedSections: Math.max(0, startSections - finalSections),
    overBudget,
    tier: appliedTier,
  }
}

// ── (e) Deterministic health-subscores chart gate ───────────────────────────
/**
 * True iff the user asked about the health score / sub-scores AND the model's
 * response shipped no [CHART:] or [STAT:] marker of its own — the case where we
 * attach [CHART:bar|health-subscores] deterministically.
 */
export function shouldAttachHealthChart(userMessage: string, responseText: string): boolean {
  if (!responseText) return false
  if (responseText.includes('[CHART:') || responseText.includes('[STAT:')) return false
  return /health score|sub-?scores|what.?s driving (my|the) (score|health)|which (sub-?score|component)/i.test(
    userMessage || '',
  )
}

// ── (f) Withheld-value claims ───────────────────────────────────────────────
// A fabrication class the projected-score guard does not cover: the prose
// restates a quantity the app's OWN view renders as unknown/withheld, as if it
// were a known number. First instance found live on prod (2026-09-16): the P&L
// bridge chart declares the start UNKNOWN ("Activity history on file starts
// 2024-09-16 — the first bar is the unknown start"), while the prose above it
// printed "Opening Position ~$97,580" — the aggregate cost basis (value − P&L),
// a figure the model DOES have, relabeled as the account's starting capital.
//
// Detection is deliberately narrow: a withheld-value LABEL and a CURRENCY figure
// must appear on the same line. That keeps ordinary prose (and legitimate rows
// like "Cost Basis") untouched. It is table-driven, so a new withheld-value
// shape is one entry — not a new function.
//
// Scope limit (documented, not a bug): this suppresses the CLAIM, it does not give
// the model general consistency with what its own charts will render. A different
// prose/chart mismatch stays structurally possible until the prose is reconciled
// against the resolved chart (tracked follow-up).
export interface WithheldValueClaim {
  id: string
  /** Vocabulary naming a quantity the app withholds/renders as unknown. */
  label: RegExp
  /** Honest replacement line, injected when a claim is removed. */
  note: string
  /** When true, the claim only counts if the response ships a [CHART:] marker. */
  requiresChartMarker: boolean
}

const MONEY_RE = /(?:\$\s?\d[\d,]*(?:\.\d+)?\s*[KMB]?\b|\b\d[\d,]*(?:\.\d+)?\s*(?:USD|dollars?)\b)/i

export const WITHHELD_VALUE_CLAIMS: WithheldValueClaim[] = [
  {
    id: 'unknown_start',
    label: new RegExp(
      String.raw`\b(?:(?:opening|starting|start-of-period|initial|original|inception|beginning|entry)\s+(?:position|balance|capital|value|investment|equity|principal|amount)|capital\s+(?:at|from)\s+(?:the\s+)?(?:start|inception|beginning)|money\s+you\s+(?:started|began)\s+with|what\s+you\s+(?:started|began)\s+(?:with|in))\b`,
      'i',
    ),
    note:
      'Starting value: **unknown** — the chart shows the opening stage as an unknown start ' +
      '(the activity history on file does not reach inception), not a figure.',
    requiresChartMarker: true,
  },
]

const rgHasChartMarker = (text: string) => /\[CHART:[^\]\n]*\]/.test(text)
const rgIsTableRow = (l: string) => /^\s*\|/.test(l)
const rgIsMarkerLine = (l: string) => /^\s*\[[^\]]*\]\s*$/.test(l)
const rgIsClaimLine = (line: string, c: WithheldValueClaim) => c.label.test(line) && MONEY_RE.test(line)

/**
 * Returns the first withheld-value claim found (label + a currency figure on the
 * same line), else null. `only` restricts the check to specific claim ids.
 */
export function detectWithheldValueClaim(
  text: string,
  only?: string[],
): { id: string; match: string } | null {
  if (!text) return null
  const charted = rgHasChartMarker(text)
  for (const c of WITHHELD_VALUE_CLAIMS) {
    if (only && !only.includes(c.id)) continue
    if (c.requiresChartMarker && !charted) continue
    const g = new RegExp(c.label.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = g.exec(text)) !== null) {
      if (m[0].length === 0) {
        g.lastIndex++
        continue
      }
      const lineEnd = text.indexOf('\n', m.index)
      const line = text.slice(m.index, lineEnd === -1 ? text.length : lineEnd)
      if (MONEY_RE.test(line)) return { id: c.id, match: m[0].trim() }
    }
  }
  return null
}

/** Claim-specific convenience wrapper (the first withheld-value shape found). */
export function detectUnknownStartClaim(text: string): string | null {
  const hit = detectWithheldValueClaim(text, ['unknown_start'])
  return hit ? hit.match : null
}

/**
 * Strip withheld-value claims: a table row carrying the label+figure is dropped
 * whole; a prose sentence carrying it is dropped whole (sibling sentences and
 * their figures are kept). Each removal injects the claim's honest note, placed
 * after the prose/table body but BEFORE any trailing marker-only lines. Counts
 * removals and reports the claim ids touched.
 */
export function suppressWithheldValueClaims(
  text: string,
  only?: string[],
): { text: string; removed: number; ids: string[] } {
  if (!text) return { text, removed: 0, ids: [] }
  const charted = rgHasChartMarker(text)
  const active = WITHHELD_VALUE_CLAIMS.filter(
    (c) => (!only || only.includes(c.id)) && (!c.requiresChartMarker || charted),
  )
  if (active.length === 0) return { text, removed: 0, ids: [] }

  const ids = new Set<string>()
  const notes: string[] = []
  let removed = 0
  const out: string[] = []

  for (const line of text.split('\n')) {
    const hit = active.find((c) => rgIsClaimLine(line, c))
    if (!hit) {
      out.push(line)
      continue
    }
    if (rgIsTableRow(line)) {
      removed++
      ids.add(hit.id)
      notes.push(hit.note)
      continue
    }
    const kept = line
      .split(/(?<=[.!?])\s+/)
      .filter((s) => {
        if (!rgIsClaimLine(s, hit)) return true
        removed++
        ids.add(hit.id)
        notes.push(hit.note)
        return false
      })
    const rejoined = kept.join(' ').trim()
    if (rejoined) out.push(rejoined)
  }

  let result = out.join('\n').replace(/\n{3,}/g, '\n\n')
  if (notes.length > 0) {
    const noteBlock = Array.from(new Set(notes)).join('\n')
    const rl = result.split('\n')
    let insertAt = rl.length
    while (insertAt > 0 && (rgIsMarkerLine(rl[insertAt - 1]) || rl[insertAt - 1].trim() === '')) insertAt--
    result = [...rl.slice(0, insertAt), '', noteBlock, ...rl.slice(insertAt)]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }
  return { text: result, removed, ids: [...ids] }
}

/** The first withheld-value shape (opening/starting capital), named explicitly. */
export function suppressUnknownStartClaims(text: string): { text: string; removed: number; ids: string[] } {
  return suppressWithheldValueClaims(text, ['unknown_start'])
}
