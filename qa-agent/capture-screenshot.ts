// ───────────────────────────────────────────────────────────────
// qa-agent/capture-screenshot.ts — the capture_screenshot tool.
//
//   captureScreenshot(screen_key: string) -> { image, matched_key, description }
//
// Loads qa-agent/screen-map.json, fuzzy-matches screen_key against each
// entry's `description` (reusing the ticker-resolver's tokenize + Levenshtein
// approach via lib/ai/normalize), logs in with the shared demo-mode helper,
// navigates to the matched route, runs its primitive actions, and returns a
// full-page Pixel 5 screenshot as base64.
//
// Never requires an exact key match; on no-match it returns the 3 closest
// candidate descriptions instead of guessing.
// ───────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import { chromium, devices } from 'playwright';
import { normalizeMessage, editDistance } from '../lib/ai/normalize';
import {
  setupDemoMode,
  clickTab,
  waitForAppLoad,
  runAction,
  primeLazyContent,
  ROUTE_TABS,
  type ScreenAction,
} from './helpers';

// ── Types ──────────────────────────────────────────────────────

interface ScreenEntry {
  key: string;
  description: string;
  route: string;
  actions: ScreenAction[];
  default?: boolean;
}

interface ScreenMap {
  default?: string;
  threshold?: number;
  screens: ScreenEntry[];
}

interface Candidate {
  key: string;
  description: string;
  score: number;
}

export interface CaptureResult {
  ok: boolean;
  matched_key?: string;
  description?: string;
  image?: string;
  route?: string;
  score?: number;
  warnings?: string[];
  error?: string;
  candidates?: Candidate[];
}

// ── Screen map loading ─────────────────────────────────────────

const MAP_PATH = path.join(__dirname, 'screen-map.json');

export function loadScreenMap(): ScreenMap {
  if (!fs.existsSync(MAP_PATH)) {
    throw new Error(`Screen map not found at ${MAP_PATH}`);
  }
  const raw = fs.readFileSync(MAP_PATH, 'utf8');
  const parsed = JSON.parse(raw) as ScreenMap;
  if (!Array.isArray(parsed.screens) || parsed.screens.length === 0) {
    throw new Error('screen-map.json must contain a non-empty "screens" array');
  }
  return parsed;
}

// ── Fuzzy matching (reuses lib/ai/normalize) ───────────────────
//
// Same approach the ticker-resolver relies on: normalize + tokenize (filler
// stripped) + Levenshtein edit distance for typo tolerance. The query is
// matched against `description` only — the entry key is never used — so a
// generic input like "portfolio" lands on the base entry rather than
// over-matching a more specific one.

function tokens(msg: string): string[] {
  return normalizeMessage(msg).tokens;
}

function compact(msg: string): string {
  return normalizeMessage(msg).compact;
}

export function fuzzyScore(query: string, description: string): number {
  const qTok = tokens(query);
  const dTok = tokens(description);
  if (qTok.length === 0) return 0;

  const qc = compact(query);
  const dc = compact(description);

  // 1. Exact (post-normalization) match.
  if (qc === dc) return 1.0;

  // 2. Containment — query is a subset of the description (or vice versa).
  if (dc.includes(qc)) return 0.95;
  if (qc.includes(dc)) return 0.88;

  // 3. Token overlap: coverage (query tokens found) + Jaccard.
  const dSet = new Set(dTok);
  let overlap = 0;
  for (const t of qTok) if (dSet.has(t)) overlap++;
  const union = new Set([...qTok, ...dTok]).size;
  const jaccard = union === 0 ? 0 : overlap / union;
  const coverage = qTok.length === 0 ? 0 : overlap / qTok.length;
  let score = 0.7 * coverage + 0.3 * jaccard;

  // 4. Single-token queries: allow typo tolerance via edit distance.
  if (qTok.length === 1) {
    for (const dt of dTok) {
      const maxLen = Math.max(qTok[0].length, dt.length);
      const levSim = maxLen === 0 ? 0 : 1 - editDistance(qTok[0], dt) / maxLen;
      if (levSim > 0.7) score = Math.max(score, levSim * 0.85);
    }
  }

  return score;
}

export function matchScreen(screenKey: string, map?: ScreenMap): {
  entry?: ScreenEntry;
  score: number;
  candidates: Candidate[];
} {
  const m = map ?? loadScreenMap();
  const scored: Candidate[] = m.screens
    .map((s) => ({ key: s.key, description: s.description, score: fuzzyScore(screenKey, s.description) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const threshold = m.threshold ?? 0.6;
  if (!best || best.score < threshold) {
    return { score: best?.score ?? 0, candidates: scored.slice(0, 3) };
  }
  const entry = m.screens.find((s) => s.key === best.key);
  return { entry, score: best.score, candidates: scored.slice(0, 3) };
}

// ── The tool ───────────────────────────────────────────────────

export async function captureScreenshot(screenKey: string): Promise<CaptureResult> {
  const raw = (screenKey ?? '').trim();
  if (!raw) {
    return { ok: false, error: 'empty_screen_key', candidates: [] };
  }

  const map = loadScreenMap();
  const match = matchScreen(raw, map);
  if (!match.entry) {
    return {
      ok: false,
      error: 'no_match',
      candidates: match.candidates.map((c) => ({
        key: c.key,
        description: c.description,
        score: Math.round(c.score * 1000) / 1000,
      })),
    };
  }

  const entry = match.entry;
  const route = entry.route;
  const warnings: string[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...devices['Pixel 5'] });
    const page = await context.newPage();

    await setupDemoMode(page);

    const tabLabel = ROUTE_TABS[route];
    if (tabLabel) {
      await clickTab(page, tabLabel);
      await waitForAppLoad(page);
    } else {
      warnings.push(`Unknown route "${route}" — no tab mapping; staying on default view`);
    }

    // Run actions in order.
    for (const action of entry.actions ?? []) {
      const res = await runAction(page, action);
      if (!res.ok && res.warning) warnings.push(res.warning);
    }

    await primeLazyContent(page);

    const buffer = await page.screenshot({ fullPage: true, animations: 'disabled' });
    const image = buffer.toString('base64');

    return {
      ok: true,
      matched_key: entry.key,
      description: entry.description,
      image,
      route,
      score: Math.round(match.score * 1000) / 1000,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err: any) {
    return { ok: false, error: `capture_failed: ${err?.message ?? err}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── CLI entry point ────────────────────────────────────────────
// Usage: npx ts-node capture-screenshot.ts "the expanded chewy card"
if (require.main === module) {
  const query = process.argv[2];
  if (!query) {
    console.error('Usage: npx ts-node capture-screenshot.ts "<screen_key>"');
    process.exit(1);
  }
  captureScreenshot(query)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 2);
    })
    .catch((err) => {
      console.error(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
      process.exit(1);
    });
}
