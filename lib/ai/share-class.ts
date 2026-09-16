// ─── Share-class guard ────────────────────────────────────────
// GOOG vs GOOGL (and BRK.A vs BRK.B, FOX vs FOXA, …) are DIFFERENT
// securities that resolve to the SAME company name. Both trade gates
// (`validateRecommendations` in lib/validate-recommendations.ts and
// Gate 2 of lib/ai/trade-gate.ts) compare COMPANY NAMES, so a marker
// written beside a position of the sibling class passes both gates and
// would offer a trade in the wrong share class.
//
// This module is pure and dependency-free: it answers "are these two
// tickers share-class siblings?" and "does the prose near this marker
// name a sibling ticker?" — the two situations that produce a
// wrong-ticker action row.

/** Curated dual-class (and economically-equivalent) ticker families. */
const SHARE_CLASS_FAMILIES: string[][] = [
  ['GOOG', 'GOOGL'], // Alphabet Class C / Class A
  ['FOX', 'FOXA'], // Fox Class B / Class A
  ['NWS', 'NWSA'], // News Corp Class B / Class A
  ['BRK.A', 'BRK.B'], // Berkshire Hathaway
  ['LEN', 'LEN.B'], // Lennar
  ['UHAL', 'UHAL.B'], // U-Haul
  ['HEI', 'HEI.A'], // Heico
  ['UA', 'UAA'], // Under Armour
  ['BATRA', 'BATRK'], // Atlanta Braves
  ['LSXMA', 'LSXMK', 'LSXMB'], // Liberty SiriusXM
  ['DISCA', 'DISCK'], // Discovery
  ['RDS.A', 'RDS.B'], // Shell (legacy)
  ['WSO', 'WSO.B'], // Watsco
  ['MOG.A', 'MOG.B'], // Moog
  ['CWEN', 'CWEN.A'], // Clearway Energy
  ['GEF', 'GEF.B'], // Greif
].map((f) => f.map((s) => s.toUpperCase()))

const FAMILY_BY_TICKER = new Map<string, string>()
for (const family of SHARE_CLASS_FAMILIES) {
  const key = family[0]
  for (const t of family) if (!FAMILY_BY_TICKER.has(t)) FAMILY_BY_TICKER.set(t, key)
}

const norm = (s: string) => (s || '').trim().toUpperCase()

/**
 * Canonical family key for a ticker, or null when it has no known sibling.
 * Falls back to the dot/dash class convention (`BRK.B` → family `BRK`).
 */
export function shareClassFamily(symbol: string): string | null {
  const s = norm(symbol)
  if (!s) return null
  const known = FAMILY_BY_TICKER.get(s)
  if (known) return known
  // Generic dotted/dashed class suffix: BRK.B, LEN.B, HEI.A, UHAL.B
  const m = s.match(/^([A-Z]{1,5})[.\-]([A-Z]{1,2})$/)
  if (m) return m[1]
  return null
}

/**
 * Returns the candidate ticker that is a share-class sibling of `symbol`
 * (same family, different ticker), or null. Order of `candidates` wins.
 */
export function findShareClassSibling(symbol: string, candidates: readonly string[]): string | null {
  const s = norm(symbol)
  const fam = shareClassFamily(s)
  if (!fam) return null
  for (const c of candidates) {
    const t = norm(c)
    if (!t || t === s) continue
    if (shareClassFamily(t) === fam) return t
  }
  return null
}

const TICKER_RE = /\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/g

/**
 * Does the prose near a marker (default ±220 chars) name a DIFFERENT
 * share class of the same company? This catches the narrative slip
 * ("…AMZN ($18.7K), GOOG ($13.6K)" written beside `[RECOMMEND:GOOGL:…]`)
 * without needing the user's holdings.
 */
export function siblingMentionedNear(
  text: string,
  symbol: string,
  markerIndex: number,
  window = 220,
): string | null {
  const fam = shareClassFamily(symbol)
  if (!fam) return null
  const s = norm(symbol)
  const start = Math.max(0, markerIndex - window)
  const end = Math.min(text.length, markerIndex + window)
  const slice = text.slice(start, end)
  for (const m of slice.matchAll(TICKER_RE)) {
    const t = norm(m[0])
    if (t === s) continue
    if (!FAMILY_BY_TICKER.has(t) && !/^[A-Z]{1,5}[.\-][A-Z]{1,2}$/.test(t)) continue
    if (shareClassFamily(t) === fam) return t
  }
  return null
}

export interface ShareClassStrip {
  /** The marker's ticker that was removed. */
  symbol: string
  /** The sibling class that made it ambiguous. */
  sibling: string
  /** True when the user actually holds the sibling class. */
  held: boolean
}

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const countWord = (n: number): string => (n >= 1 && n <= 10 ? COUNT_WORDS[n] : String(n))
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`

/** Does this text name `symbol` as a standalone ticker token? */
function namesSymbol(text: string, symbol: string): boolean {
  const s = escapeRe(symbol).replace(/\\[.\-]/g, '[.\\-]')
  return new RegExp(`(^|[^A-Za-z0-9])${s}([^A-Za-z0-9]|$)`, 'i').test(text)
}

/** Sum of the `$` amounts still carried by `[RECOMMEND:...]` markers (null when none). */
export function recommendTotal(text: string): number | null {
  const re = /\[RECOMMEND:[A-Z]{1,5}(?:[.\-][A-Z]{1,2})?:(?:BUY|SELL)(?::\$?([\d,]+(?:\.\d+)?))?\]/g
  let total = 0
  let n = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[1]) {
      total += Number(m[1].replace(/,/g, ''))
      n++
    }
  }
  return n ? total : null
}

/** End index (exclusive) of a `[PREFIX:{...}]` marker using brace counting. */
function endOfJsonMarker(text: string, start: number, open: string): number {
  let depth = 0
  for (let j = start + open.length - 1; j < text.length; j++) {
    const ch = text[j]
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) {
        // The marker is `[PREFIX:{...}]`: counting starts at the `{`, so the
        // wrapper's closing `]` is one char past the balanced JSON.
        return text[j + 1] === ']' ? j + 2 : j + 1
      }
    }
  }
  return -1
}

function portfolioSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  let from = 0
  while (from < text.length) {
    const i = text.indexOf('[PORTFOLIO:{', from)
    if (i < 0) break
    const end = endOfJsonMarker(text, i, '[PORTFOLIO:{')
    if (end < 0) break
    spans.push({ start: i, end })
    from = end
  }
  return spans
}

/**
 * Drop blocked tickers from every `[PORTFOLIO:{...}]` allocation block so the
 * downloaded plan matches the buttons that actually render. The block is removed
 * entirely when nothing tradable is left in it.
 */
function prunePortfolioBlocks(text: string, blocked: Set<string>): string {
  const spans = portfolioSpans(text)
  let out = text
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end } = spans[i]
    const raw = out.slice(start, end)
    const json = raw.slice('[PORTFOLIO:'.length, raw.length - 1)
    let obj: any
    try {
      obj = JSON.parse(json)
    } catch {
      continue
    }
    const positions = Array.isArray(obj?.positions) ? obj.positions : null
    if (!positions) continue
    const kept = positions.filter((p: any) => !blocked.has(norm(String(p?.symbol ?? ''))))
    if (kept.length === positions.length) continue
    if (kept.length === 0) {
      out = out.slice(0, start) + out.slice(end)
      continue
    }
    obj.positions = kept
    if (typeof obj.total === 'number') {
      const sum = kept.reduce((a: number, p: any) => a + (Number(p?.amount) || 0), 0)
      if (sum > 0) obj.total = sum
    }
    out = out.slice(0, start) + `[PORTFOLIO:${JSON.stringify(obj)}]` + out.slice(end)
  }
  return out
}

/**
 * Drop blocked tickers from the `[SUMMARY_TLDR:...]` card (the "3 positions"
 * summary / download line) and re-state the count + total from what survives.
 */
function pruneSummaryTldr(text: string, blocked: Set<string>, total: number | null): string {
  if (!blocked.size) return text
  const mentionsBlocked = (fragment: string) => [...blocked].some((s) => namesSymbol(fragment, s))
  return text.replace(/\[SUMMARY_TLDR:([^\]]*)\]/g, (match, inner: string) => {
    const dashSplit = inner.split(/\s+[—–]\s+/)
    const head = dashSplit[0]
    const detail = dashSplit.slice(1).join(' — ')
    if (!detail) return mentionsBlocked(inner) ? '' : match
    const segs = detail.split(/,\s*/)
    const kept = segs.filter((s) => !mentionsBlocked(s))
    if (kept.length === segs.length) return match
    if (kept.length === 0) return ''
    let newHead = head.replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(positions?|bets?|names?|stocks?|tickers?|holdings?)/i,
      (_m: string, _n: string, noun: string) => `${countWord(kept.length)} ${noun}`,
    )
    if (total != null) newHead = newHead.replace(/\$[\d,]+(?:\.\d+)?/, money(total))
    return `[SUMMARY_TLDR:${newHead} — ${kept.join(', ')}]`
  })
}

/**
 * Remove the model's typed-confirm instructions for a blocked ticker
 * ("Reply **\"confirm GOOG\"** to execute") — a button the guard just removed
 * must not be advertised in prose. Instructions for surviving symbols stay.
 */
function dropConfirmInstructions(text: string, blocked: Set<string>): string {
  if (!blocked.size) return text
  const alts = [...blocked].map(escapeRe).join('|')
  const blockedRe = new RegExp(`confirm\\s+(?:${alts})\\b`, 'i')
  const anyConfirmRe = /confirm\s+([A-Z]{1,5}(?:[.\-][A-Z]{1,2})?)/gi
  const kept: string[] = []
  for (const line of text.split('\n')) {
    if (!blockedRe.test(line)) {
      kept.push(line)
      continue
    }
    // Keep the line only if it ALSO instructs a confirm for a non-blocked symbol.
    let surviving = false
    let m: RegExpExecArray | null
    anyConfirmRe.lastIndex = 0
    while ((m = anyConfirmRe.exec(line)) !== null) {
      if (!blocked.has(norm(m[1]))) { surviving = true; break }
    }
    if (!surviving) continue
    const sentences = line.split(/(?<=[.!?])\s+/).filter((s) => !blockedRe.test(s))
    const out = sentences.join(' ').trim()
    if (out) kept.push(out)
  }
  return kept.join('\n')
}

/** Collapse the whitespace left behind by removing a marker. */
function tidyAfterStrip(text: string): string {
  const lines = text.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, ''))
  const out: string[] = []
  for (const l of lines) {
    if (l.trim() === '' && out.length && out[out.length - 1].trim() === '') continue
    out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * HARD-BLOCK variant (Em, 2026-09-16).
 *
 * When a `[RECOMMEND:SYM:...]` marker sits beside prose that names a DIFFERENT
 * share class of the same company (the incident shape), or when the user holds
 * that sibling class, the marker is REMOVED from the text ENTIRELY so no trade
 * button can render next to an unresolved share-class ambiguity. The prose is
 * left standing — the same outcome as the light path, which strips markers
 * before finalisation and therefore never builds a button.
 *
 * Markers with no share-class conflict are returned untouched.
 */
export function stripConflictingRecommendMarkers(
  text: string,
  heldSymbols: readonly string[] = [],
): { text: string; stripped: ShareClassStrip[] } {
  if (!text || !text.includes('[RECOMMEND:')) return { text, stripped: [] }
  const markerRe = /\[RECOMMEND:([A-Z]{1,5}(?:[.\-][A-Z]{1,2})?):[^\]]*\]/g
  const stripped: ShareClassStrip[] = []
  const seen = new Set<string>()
  const replaced = text.replace(markerRe, (match, sym: string, offset: number) => {
    const s = norm(sym)
    const heldSibling = heldSymbols.length ? findShareClassSibling(s, heldSymbols) : null
    const proseSibling = siblingMentionedNear(text, s, offset)
    const sibling = heldSibling || proseSibling
    if (!sibling) return match
    const key = `${s}->${sibling}`
    if (!seen.has(key)) {
      seen.add(key)
      stripped.push({ symbol: s, sibling, held: Boolean(heldSibling) })
    }
    return ''
  })
  if (!stripped.length) return { text, stripped: [] }
  const blocked = new Set(stripped.map((s) => s.symbol))
  // The marker is gone, but the same response still carries three other places
  // that mention it: the summary card line, the downloadable plan block, and the
  // model's typed-confirm instruction. All three must agree with what renders.
  let out = prunePortfolioBlocks(replaced, blocked)
  out = pruneSummaryTldr(out, blocked, recommendTotal(out))
  out = dropConfirmInstructions(out, blocked)
  return { text: tidyAfterStrip(out), stripped }
}

/**
 * Builds the user-facing disclosure for a share-class risk. Returns null
 * when there is nothing to say.
 */
export function shareClassNote(symbol: string, sibling: string, heldSibling: boolean): string | null {
  const s = norm(symbol)
  const sib = norm(sibling)
  if (!s || !sib || s === sib) return null
  if (heldSibling) {
    return (
      `\n\n⚠️ **Share-class check:** you hold **${sib}** — **${s}** is the other share class of the same ` +
      `company and is a *different security*. The action above trades **${s}**, not your **${sib}** position.`
    )
  }
  return (
    `\n\n⚠️ **Share-class check:** **${s}** and **${sib}** are different share classes of the same ` +
    `company — make sure the ticker above is the one you want.`
  )
}
