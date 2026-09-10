// ─── Insights: "More from Rufus" copy + selection ───────────
// Pure, dependency-free helpers for the secondary notices list that sits
// BELOW the hero deck (see components/insights/MoreFromRufus.tsx).
//
// This module NEVER re-implements trigger logic. It only decides (a) which
// noticed items belong in the secondary list and (b) how to render ONE line
// of Rufus-voice copy for each — preferring the AI-generated `body`, and
// falling back to a humanization of the structured fields when the body is
// still the raw deterministic context string (the engine leak).
//
// ⚠️ HARD RULE: never surface the raw deterministic context. Strings like
// "severity: info", "Informational only", "crossed … total return
// threshold", "Position value: $…" are context internals, not copy. Any body
// containing one of those markers is REJECTED wholesale and the field-derived
// fallback is used instead.

/* ── Which items belong in the secondary list? ─────────────── */
//
// (a) event-impact INFO-tier — purely informational, NO action link.
// (b) position milestones (incl. user-configured target-return / target-loss
//     crossings — the engine fires those through the SAME position_milestone
//     type, see lib/noticed/engine.ts findNewTriggers) — actionable.
//
// Deck-eligible types (concentration_*, idle_cash, bounce_back, and
// event_impact review-tier) are deliberately NOT eligible here: they live in
// the hero deck and must never be duplicated.
export function isMoreFromRufusEligible(item: any): boolean {
  if (!item || typeof item.triggerType !== 'string') return false;
  if (item.triggerType === 'event_impact') return item?.meta?.severity === 'info';
  if (item.triggerType === 'position_milestone') return true;
  return false;
}

/** Deterministic ticker for the actionable "Review" link, or null when the
 *  item carries no REVIEW_POSITION marker (i.e. informational). */
export function reviewTickerForItem(item: any): string | null {
  const action = item?.action ?? item?.meta?.action;
  if (typeof action !== 'string') return null;
  const PREFIX = 'REVIEW_POSITION:';
  if (!action.startsWith(PREFIX)) return null;
  const ticker = action.slice(PREFIX.length).trim();
  return ticker || null;
}

/* ── Raw-context detection ─────────────────────────────────── */

const RAW_CONTEXT_MARKERS: RegExp[] = [
  /\bseverity:\s*(?:info|review)/i,
  /informational only/i,
  /no action needed unless your original thesis has changed/i,
  /\btotal return threshold\b/i,
  /position value:\s*\$/i,
  /\binvestor style:/i,
  /\(after open orders\)/i,
  /consecutive trading days/i,
];

/** True when a string is (or contains) the raw deterministic context. */
export function hasRawContextMarker(s: string): boolean {
  if (!s) return true;
  return RAW_CONTEXT_MARKERS.some((re) => re.test(s));
}

/* ── Structured-field fallbacks (never the raw string) ─────── */

const EVENT_PHRASE: Record<string, string> = {
  regulatory: 'has a regulatory update',
  earnings: 'posted an earnings update',
  corporate_action: 'has corporate news',
  product: 'has a product update',
};

function symbolOf(item: any): string {
  const sym = item?.meta?.symbol;
  if (typeof sym === 'string' && sym.trim()) return sym.trim().toUpperCase();
  // Last resort: the first token of the title (e.g. "NVDA — earnings update").
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  return title.split(/[\s—:-]+/)[0] || 'A holding';
}

function fallbackEventText(item: any): string {
  const m = item?.meta || {};
  const sym = symbolOf(item);
  const phrase = EVENT_PHRASE[m.category] || 'has an update';
  const headline = typeof m.headline === 'string' ? m.headline.trim() : '';
  return headline ? `${sym} ${phrase} — ${headline}` : `${sym} ${phrase}`;
}

function fallbackMilestoneText(item: any): string {
  const m = item?.meta || {};
  const sym = symbolOf(item);
  const th = Number(m.threshold);
  if (!Number.isFinite(th)) return `${sym} crossed a return milestone — worth a look.`;
  const cur = Number(m.currentPnlPct);
  const now = Number.isFinite(cur) ? ` (now ${cur > 0 ? '+' : ''}${Math.round(cur)}%)` : '';
  return `${sym} crossed ${th > 0 ? '+' : ''}${th}%${now} — worth a look.`;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/* ── The one-line humanizer ────────────────────────────────── */

/**
 * ONE line of Rufus-voice copy for a noticed item.
 *   (1) pass through the AI-generated body when it is real copy,
 *   (2) reject anything that still looks like raw deterministic context,
 *   (3) otherwise build a humanized line from the item's structured fields.
 */
export function humanizeNoticedItem(item: any): string {
  const body = typeof item?.body === 'string' ? item.body.trim() : '';
  if (body && !hasRawContextMarker(body)) return collapse(body);

  switch (item?.triggerType) {
    case 'position_milestone':
      return fallbackMilestoneText(item);
    case 'event_impact':
      return fallbackEventText(item);
    case 'idle_cash': {
      const amt = Number(item?.meta?.amount);
      if (Number.isFinite(amt)) {
        const days = Number.isFinite(Number(item?.meta?.daysIdle)) ? ` for ${Number(item.meta.daysIdle)} trading days` : '';
        return `$${amt.toLocaleString()} of cash has been idle${days}.`;
      }
      const t = typeof item?.title === 'string' ? item.title.trim() : '';
      return t || 'Cash is sitting idle.';
    }
    default: {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      return title || 'Something worth a look.';
    }
  }
}
