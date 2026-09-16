// ─── Response de-duplication ──────────────────────────────────
// The chat UI renders the ETF/stock breakdown ONCE, as boxed position cards
// built from `[POSITION:<TICKER>:…]` markers. The system prompt tells the model
// not to also write that breakdown as prose, but it sometimes still emits an
// inline bullet/table list near the top that duplicates the cards at the bottom
// ("recession-proof portfolio" was the reported case).
//
// This is a CONSERVATIVE, deterministic backstop that runs server-side on the
// final text. It only ever removes lines that are:
//   - a markdown list item, a table row, or a bold/heading label, AND
//   - mention at least one ticker that has a [POSITION:] marker, AND
//   - carry a percentage or a dollar amount (i.e. a real breakdown entry).
// It never removes marker lines, recommendation/confirmation lines, or plain
// prose paragraphs. When a section heading is left with nothing under it, the
// heading goes too, so no empty "Asset allocation" label is orphaned.

const POSITION_MARKER_RE = /\[POSITION:([A-Z][A-Z0-9.\-]{0,6}):/g;
const PROTECTED_MARKER_RE = /\[(?:POSITION|RECOMMEND):/;
const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const HEADING_RE = /^\s*(?:#{1,6}\s+\S|\*\*[^*]+\*\*\s*$)/;
const AMOUNT_RE = /(\d+(?:\.\d+)?\s*%|\$\s?\d)/;

export function stripDuplicateBreakdownProse(text: string): { text: string; removed: number } {
  if (!text || !text.includes('[POSITION:')) return { text, removed: 0 };

  // Tickers that already have a rendered card.
  const tickers = new Set<string>();
  let m: RegExpExecArray | null;
  POSITION_MARKER_RE.lastIndex = 0;
  while ((m = POSITION_MARKER_RE.exec(text))) tickers.add(m[1]);
  if (tickers.size === 0) return { text, removed: 0 };

  const lines = text.split('\n');

  const mentionsCardTicker = (line: string): boolean => {
    // Word-boundary match on each ticker (escape the few non-word chars tickers allow).
    for (const t of tickers) {
      const re = new RegExp(`(?:^|[^A-Z0-9.\\-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Z0-9.\\-]|$)`);
      if (re.test(line)) return true;
    }
    return false;
  };

  const isDupeLine = (line: string): boolean => {
    if (!line.trim()) return false;
    if (PROTECTED_MARKER_RE.test(line)) return false; // never touch graph/marker lines
    const shape = LIST_LINE_RE.test(line) || TABLE_ROW_RE.test(line) || HEADING_RE.test(line);
    if (!shape) return false;
    return AMOUNT_RE.test(line) && mentionsCardTicker(line);
  };

  const dropped = lines.map(isDupeLine);

  // Drop a heading whose section is now entirely dropped lines (skip blanks,
  // stop at the next heading or the next surviving paragraph/list line).
  for (let i = 0; i < lines.length; i++) {
    if (!dropped[i] && HEADING_RE.test(lines[i]) && !isDupeLine(lines[i])) {
      let j = i + 1;
      let sawContent = false;
      let allDropped = true;
      while (j < lines.length) {
        const t = lines[j];
        if (!t.trim()) { j++; continue; }
        if (HEADING_RE.test(t)) break;
        if (PROTECTED_MARKER_RE.test(t)) { j++; continue; } // cards aren't prose
        if (dropped[j]) { sawContent = true; j++; continue; }
        // First surviving non-heading prose line ends the section.
        allDropped = false;
        break;
      }
      if (sawContent && allDropped) {
        dropped[i] = true;
      }
    }
  }

  const removed = dropped.filter(Boolean).length;
  if (removed === 0) return { text, removed: 0 };

  const out = lines.filter((_, i) => !dropped[i]);
  // Collapse any run of 3+ blank lines left behind into a single blank line.
  const joined = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: joined, removed };
}
