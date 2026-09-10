// ─── Brief content helpers (Daily Brief + Weekly Snapshot) ──────────────
// Pure parsing/formatting helpers shared by the Insights brief modal.
//
// These deliberately mirror the parsing CONTRACT of the existing brief cards
// (`components/ai/DailyBriefCard.tsx`, `components/ai/WeeklySnapshotCard.tsx`)
// so the content shown in the Insights modal is the SAME content already
// produced by the existing endpoints — section labels, ordering and text are
// untouched. The cards themselves are NOT reused here because they are
// styled as dark-only surfaces and the Insights canvas is light by default.
//
// NO trigger logic, NO API shape changes live in this file.

/** One labelled line of a Daily Brief ("MARKET: ..."). */
export interface BriefLine {
  /** 'MARKET' | 'PORTFOLIO' | 'WATCH' | 'EARNINGS', or '' for unlabelled prose. */
  label: string;
  text: string;
}

/** Section tag order + accent for the Daily Brief (same set as the card). */
export const DAILY_TAGS = ['MARKET', 'PORTFOLIO', 'WATCH', 'EARNINGS'] as const;

/**
 * Parse a Daily Brief body into labelled lines.
 * Same regex as `DailyBriefCard.parseBrief` — unlabelled lines are kept as prose.
 */
export function parseDailyBrief(content: string | null | undefined): BriefLine[] {
  const lines = (content || '').split('\n').filter((l) => l.trim());
  return lines
    .map((line) => {
      const match = line.match(/^(MARKET|PORTFOLIO|WATCH|EARNINGS):\s*(.+)/i);
      if (match) return { label: match[1].toUpperCase(), text: match[2].trim() };
      return { label: '', text: line.trim() };
    })
    .filter((l) => l.text);
}

/**
 * Human label for a weekly snapshot's `riskLevel` / health pair.
 * Kept here so the modal header can render the same derived summary line the
 * deck teaser uses.
 */
export function weeklySummaryLine(healthScore: number | null | undefined, riskLevel: string | null | undefined): string {
  const health = healthScore != null ? `Health ${healthScore}/10` : '';
  const risk = riskLevel ? `Risk ${String(riskLevel).toUpperCase()}` : '';
  return [health, risk].filter(Boolean).join(' · ');
}

/**
 * Build the Ask Rufus prompt that carries the brief the user just read.
 *
 * The full brief text is inlined (not summarised) so Rufus's first reply is
 * grounded in the SPECIFIC brief that was open — that is the whole point of
 * the "Ask Rufus about this" link.
 */
export function briefAskPrompt(kind: 'daily' | 'weekly', content: string): string {
  const title = kind === 'daily' ? "today's Daily Brief" : "this week's Weekly Snapshot";
  const intro =
    kind === 'daily'
      ? 'Explain what matters most here and what I should do about it.'
      : 'Walk me through what changed and what I should do about it.';
  return `Here is ${title} I just read:\n\n${(content || '').trim()}\n\n${intro}`;
}
