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
  return { text: tidyAfterStrip(replaced), stripped }
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
