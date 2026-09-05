// ───────────────────────────────────────────────────────────────
// qa-agent/critique-design.ts — the critique_design tool.
//
//   critiqueDesign(image: base64, screen_description: string)
//     -> { issues: [{category, severity, description}], redesign_proposal: string }
//
// Loads the locked design tokens (qa-agent/design-tokens-context.md), sends the
// screenshot + tokens + a fixed critique rubric to the Gemini API
// (GOOGLE_API_KEY env var), and returns structured JSON.
//
// IMPORTANT: this tool ONLY returns data to OpenClaw's calling context. It never
// posts to Telegram. It is ON-DEMAND ONLY (invoked via /redesign) and must never
// be wired into a scheduled/nightly job — if it is, that is a bug.
//
// Results are cached on disk keyed by image hash so a retry of the same image in
// the same session does not waste an API call.
// ───────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Minimal .env loader (no dotenv dependency — avoids the TS7016 type mess).
// Loads qa-agent/.env if present, so GOOGLE_API_KEY can be dropped in locally
// OR provided as a real env var on the VPS. Existing env vars always win.
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadDotEnv(path.join(__dirname, '.env'));

// ── Types ──────────────────────────────────────────────────────

export interface CritiqueIssue {
  category: string;
  severity: string;
  description: string;
}

export interface CritiqueResult {
  ok: boolean;
  issues: CritiqueIssue[];
  redesign_proposal: string;
  cached?: boolean;
  hash?: string;
  error?: string;
  model?: string;
}

// ── Constants ──────────────────────────────────────────────────

const TOKENS_PATH = path.join(__dirname, 'design-tokens-context.md');
const CACHE_DIR = path.join(__dirname, '.critique-cache');
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

// The critique rubric — verbatim, per the tool contract. Do not reword.
const RUBRIC =
  'Critique this screen against the attached design system. Flag: ' +
  '(a) information hierarchy problems - is there one clear focal element or is ' +
  'everything competing for attention, ' +
  '(b) badge/chip/metadata density - count distinct UI chrome elements stacked in one area, ' +
  '(c) consistency with the attached design tokens - any hardcoded-looking colors or ' +
  'spacing that don\'t match, ' +
  '(d) whether this would read as templated/AI-generated to a design-literate viewer, and why. ' +
  'Then propose one concrete redesign for the highest-priority issue, described precisely ' +
  'enough to hand to a developer - not a vague direction.';

// ── Design tokens context ──────────────────────────────────────

function loadTokens(): string {
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error(`Design tokens context not found at ${TOKENS_PATH}`);
  }
  return fs.readFileSync(TOKENS_PATH, 'utf8');
}

// ── Hashing & caching ──────────────────────────────────────────

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function detectMime(imageBase64: string): string {
  const head = (imageBase64 ?? '').slice(0, 32).trim();
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBOR')) return 'image/png';
  if (head.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

function cachePathFor(hash: string): string {
  return path.join(CACHE_DIR, `${hash}.json`);
}

function readCache(hash: string, description: string): CritiqueResult | null {
  try {
    const p = cachePathFor(hash);
    if (!fs.existsSync(p)) return null;
    const entry = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Only reuse if the stored description matches — same image, different prompt
    // is a different critique.
    if (entry?.description !== description) return null;
    if (!entry?.result) return null;
    return { ...entry.result, cached: true, hash };
  } catch {
    return null;
  }
}

function writeCache(hash: string, description: string, result: CritiqueResult) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      cachePathFor(hash),
      JSON.stringify({ hash, description, result, cachedAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // caching is best-effort; never fail the tool over it
  }
}

// ── Gemini API call ────────────────────────────────────────────

function buildPrompt(description: string): string {
  const tokens = loadTokens();
  return [
    'You are a senior product-design critic. Critique a mobile screen against a locked design system.',
    '',
    '=== LOCKED DESIGN SYSTEM ===',
    tokens,
    '=== END DESIGN SYSTEM ===',
    '',
    `Screen being critiqued: ${description || '(not provided)'}`,
    '',
    RUBRIC,
    '',
    'Respond with ONLY valid JSON (no markdown fences, no prose) in exactly this shape:',
    '{ "issues": [ { "category": string, "severity": string, "description": string } ], "redesign_proposal": string }',
    '',
    'Constraints:',
    '- "category" must be one of: hierarchy, density, token_consistency, templated_look, other.',
    '- "severity" must be one of: high, medium, low.',
    '- "issues" must contain one entry per flag (a)-(d) that has a real finding; omit a flag only if it is clean.',
    '- "redesign_proposal" must be ONE concrete change with specific token values, layout, or component changes a developer could implement directly — not a vague direction.',
  ].join('\n');
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; status?: string };
}

async function callGemini(
  imageBase64: string,
  description: string,
  model: string
): Promise<{ text: string }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set (add it to the VPS environment)');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(description) },
          { inline_data: { mime_type: detectMime(imageBase64), data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = (await resp.json().catch(() => ({}))) as GeminiResponse;

  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }

  const text = (data?.candidates ?? [])
    .flatMap((c) => c?.content?.parts ?? [])
    .map((p) => p?.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini API returned no text content');
  }
  return { text };
}

// ── Response parsing ───────────────────────────────────────────

function parseCritique(text: string): CritiqueResult {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to salvage a JSON object embedded in prose.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) {
      return { ok: false, issues: [], redesign_proposal: '', error: 'unparseable_response', };
    }
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return { ok: false, issues: [], redesign_proposal: '', error: 'unparseable_response' };
    }
  }

  const rawIssues: any[] = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const issues: CritiqueIssue[] = rawIssues
    .filter((i: any) => i && typeof i === 'object')
    .map((i: any) => ({
      category: String(i.category ?? 'other'),
      severity: String(i.severity ?? 'medium'),
      description: String(i.description ?? ''),
    }))
    .filter((i: CritiqueIssue) => i.description.trim().length > 0);

  const redesign_proposal = String(parsed?.redesign_proposal ?? '').trim();

  if (issues.length === 0 && !redesign_proposal) {
    return { ok: false, issues: [], redesign_proposal: '', error: 'empty_response' };
  }

  return { ok: true, issues, redesign_proposal };
}

// ── The tool ───────────────────────────────────────────────────

export async function critiqueDesign(
  imageBase64: string,
  screenDescription: string,
  opts: { model?: string; skipCache?: boolean } = {}
): Promise<CritiqueResult> {
  const img = (imageBase64 ?? '').trim();
  const description = (screenDescription ?? '').trim();

  if (!img) {
    return { ok: false, issues: [], redesign_proposal: '', error: 'empty_image' };
  }

  const hash = sha256(img);
  const model = opts.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;

  if (!opts.skipCache) {
    const cached = readCache(hash, description);
    if (cached) return cached;
  }

  try {
    const { text } = await callGemini(img, description, model);
    const result = parseCritique(text);
    result.hash = hash;
    result.model = model;
    if (result.ok) {
      writeCache(hash, description, result);
    }
    return result;
  } catch (err: any) {
    return {
      ok: false,
      issues: [],
      redesign_proposal: '',
      hash,
      model,
      error: err?.message ?? String(err),
    };
  }
}

// ── CLI entry point ────────────────────────────────────────────
// Usage:
//   npx ts-node critique-design.ts <image_file.png> "<description>"
//   npx ts-node critique-design.ts --b64 <base64> "<description>"
//   npx ts-node critique-design.ts --stdin "<description>"   (base64 piped via stdin)
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let imageBase64: string | null = null;
    let description = '';

    if (args[0] === '--b64') {
      imageBase64 = args[1] ?? null;
      description = args[2] ?? '';
    } else if (args[0] === '--stdin') {
      imageBase64 = fs.readFileSync(0, 'utf8').trim();
      description = args[1] ?? '';
    } else if (args[0] && !args[0].startsWith('--')) {
      const file = args[0];
      if (fs.existsSync(file)) {
        imageBase64 = fs.readFileSync(file).toString('base64');
      } else {
        console.error(JSON.stringify({ ok: false, error: `image file not found: ${file}` }));
        process.exit(1);
      }
      description = args[1] ?? '';
    } else {
      console.error('Usage: npx ts-node critique-design.ts <image_file.png> "<description>"');
      process.exit(1);
    }

    const result = await critiqueDesign(imageBase64 as string, description);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  })().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
    process.exit(1);
  });
}
