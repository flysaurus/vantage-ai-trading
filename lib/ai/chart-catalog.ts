// ═══════════════════════════════════════════════════════════════
// lib/ai/chart-catalog.ts — model-facing chart menu
// ═══════════════════════════════════════════════════════════════
//
// Appended to the chat system context so the model knows WHICH keys exist and
// WHEN to use each visual. It is deliberately a menu of keys, not of numbers:
// the model emits a marker key and the server resolves the real data.

import { CHART_KEYS } from './chart-registry';

/** The selection rules, verbatim, shared by the catalog and the system prompt. */
export const CHART_SELECTION_RULES = `bar = comparison across a few items | bar-grouped = current vs target on the same items |
donut = composition with ≤7 segments | treemap = composition with 8+ segments (colour = optional 2nd dimension) |
line = anything with a time axis | waterfall = additive sequence start→end | scatter = two-axis positioning across
holdings | stat = one headline number. Use a markdown table when the exact figures are the point; prose when there is
no data shape. No hierarchy — pick what actually fits. Values NEVER come from you: emit the marker key; the app
resolves real data, so a key being listed means the chart is available — never refuse or hedge because the
numbers aren't visible to you. If the data you want is not in this list, say so in prose — do not approximate, do
not invent.`;

/**
 * Compact block listing every key with its `when`, followed by the selection
 * rules. Kept short on purpose — it rides in every chat turn.
 */
export function buildChartCatalog(): string {
  const byType = new Map<string, string[]>();
  for (const [key, entry] of Object.entries(CHART_KEYS)) {
    const list = byType.get(entry.type) || [];
    list.push(`  [${entry.type === 'stat' ? 'STAT' : 'CHART'}:${
      entry.type === 'stat' ? key : `${entry.type}|${key}`
    }] — ${entry.when}`);
    byType.set(entry.type, list);
  }

  const order = ['bar', 'bar-grouped', 'donut', 'line', 'treemap', 'scatter', 'waterfall', 'stat'];
  const sections = order
    .filter((t) => byType.has(t))
    .map((t) => `${t}:\n${(byType.get(t) || []).join('\n')}`)
    .join('\n');

  return `=== VISUAL RESPONSES (keys only — never numbers) ===
Emit at most 2 chart markers per response. The app resolves every value from the
user's real data, so you do NOT need the numbers in front of you to use a key:
never refuse a visual because you can't see the figures, and never tell the user
the data is unavailable when the key is listed below. Never invent a type or a
key; a table or prose is equally valid. If you answer with prose, do not promise
a chart you did not mark.

${sections}

CHART SELECTION
${CHART_SELECTION_RULES}`;
}
