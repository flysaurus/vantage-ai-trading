// ═══════════════════════════════════════════════════════════════
// lib/ai/chart-markers.ts — chat chart markers (keys, never values)
// ═══════════════════════════════════════════════════════════════
//
// The model may ask for a chart, but it may NOT supply any numbers. It emits
// a KEY; the server resolves the real data from libs the UI already trusts
// (lib/insights/health-score, lib/portfolio/*, lib/etf-sectors, …).
//
// Grammar (single line, no nested brackets):
//   [CHART:<type>|<key>]           → key resolves to a value series
//   [CHART:<type>|<key>|<param>]   → key + a bounded param (e.g. line range)
//   [STAT:<key>]                   → one headline number
//
//   <type> ∈ bar | bar-grouped | donut | line | treemap | scatter | waterfall
//
// HARD RULES
//   • A marker whose <type> does not match the registry's canonical type for
//     that key is INVALID.
//   • Unknown type / unknown key / malformed marker / type-key mismatch /
//     resolver returning null → strip the marker silently and let the prose
//     stand. Never render a partial or invented chart.
//   • NO correlation/heatmap type, key or marker exists anywhere.

import type { ChartType, ChartRequest, ChartCtx, ChartResolveResult, ResolvedChart } from './chart-registry';
import { CHART_KEYS } from './chart-registry';

export type { ChartType, ChartRequest, ChartCtx, ResolvedChart } from './chart-registry';

/** The fixed, enumerated chart type set. Nothing is inferred from data shape. */
export const CHART_TYPES: ChartType[] = [
  'bar',
  'bar-grouped',
  'donut',
  'line',
  'treemap',
  'scatter',
  'waterfall',
];

export function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (CHART_TYPES as string[]).includes(value);
}

/** Hard cap: a response may carry at most this many charts (prompt says 2 too). */
export const MAX_CHARTS_PER_RESPONSE = 2;

// ── Parsing ───────────────────────────────────────────────────
// A well-formed marker is bounded by a closing bracket on the SAME line.
// Anything else (no closing bracket, multi-line) is "malformed" — it is never
// parsed into a request, and `stripChartMarkers` removes it from the text so a
// broken marker can never leak into the visible prose.
const MARKER_RE = /\[(CHART|STAT):([^\]\n]*)\]/g;

/**
 * Parse every well-formed chart/stat marker out of `text`, in document order,
 * deduped by `type|key|param`. Markers with an unknown type, an unexpected
 * segment count, or a missing key are dropped here (they are not requests);
 * unknown KEYS survive parsing so `validateChartRequests` can reject them.
 */
export function parseChartRequests(text: string): ChartRequest[] {
  if (!text) return [];
  const out: ChartRequest[] = [];
  const seen = new Set<string>();

  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const raw = m[0];
    const kindToken = m[1].toUpperCase();
    const body = m[2];

    let req: ChartRequest | null = null;
    if (kindToken === 'STAT') {
      // [STAT:<key>] — a stat carries no type and no param. A stray '|' makes
      // the key unmatchable, so validation drops it.
      req = { kind: 'stat', type: 'stat', key: body.trim(), raw };
    } else {
      const parts = body.split('|').map((s) => s.trim());
      if (parts.length < 2 || parts.length > 3) continue; // malformed shape
      const rawType = parts[0].toLowerCase();
      if (!isChartType(rawType)) continue; // unknown type → not a request
      const key = parts[1];
      const param = parts.length === 3 && parts[2] ? parts[2] : undefined;
      req = { kind: 'chart', type: rawType, key, param, raw };
    }

    const dedupeKey = `${req.type}|${req.key}|${req.param ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(req);
  }
  return out;
}

// ── Validation ────────────────────────────────────────────────
// Split the parsed requests into those the registry will resolve and those
// that must be stripped (unknown key, or a type that disagrees with the
// registry's canonical type for that key).
export function validateChartRequests(
  reqs: ChartRequest[],
  registry: Record<string, { type: ChartType | 'stat' }>,
): { valid: ChartRequest[]; stripAll: ChartRequest[] } {
  const valid: ChartRequest[] = [];
  const stripAll: ChartRequest[] = [];
  for (const req of reqs) {
    const entry = registry[req.key];
    if (entry && entry.type === req.type) valid.push(req);
    else stripAll.push(req);
  }
  return { valid, stripAll };
}

// ── Stripping ─────────────────────────────────────────────────
// Remove EVERY chart/stat marker regardless of validity, so an invalid marker
// is never shown as literal text. Bracket is optional so a truncated marker
// (e.g. "… [CHART:bar|sector-weight") is erased to end-of-line too. Then
// collapse the blank-line whitespace the removal leaves behind.
const STRIP_RE = /\[(?:CHART|STAT):[^\]\n]*\]?/g;

export function stripChartMarkers(text: string): string {
  if (!text) return text;
  return text
    .replace(STRIP_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Resolution ────────────────────────────────────────────────

/**
 * Validate → resolve each valid request through the registry → drop nulls.
 * A resolver that throws or returns null is treated exactly like an invalid
 * marker: it is skipped and the prose stands. Never throws.
 */
export async function resolveCharts(reqs: ChartRequest[], ctx: ChartCtx): Promise<ResolvedChart[]> {
  if (!reqs || reqs.length === 0) return [];
  const { valid } = validateChartRequests(reqs, CHART_KEYS);
  const out: ResolvedChart[] = [];

  for (const req of valid.slice(0, MAX_CHARTS_PER_RESPONSE)) {
    const entry = CHART_KEYS[req.key];
    if (!entry) continue;
    try {
      const resolved: ChartResolveResult | null = await entry.resolve({ ...ctx, param: req.param });
      if (!resolved) continue;
      out.push({
        type: entry.type,
        key: req.key,
        title: resolved.title ?? entry.label,
        subtitle: resolved.subtitle,
        footnote: resolved.footnote,
        data: resolved.data,
      });
    } catch {
      // A resolver failure is not a user-facing error — the marker is simply
      // not rendered and the surrounding prose is unaffected.
    }
  }

  return out;
}
