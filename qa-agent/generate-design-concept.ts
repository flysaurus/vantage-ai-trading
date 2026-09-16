// ───────────────────────────────────────────────────────────────
// qa-agent/generate-design-concept.ts — the generate_design_concept tool.
//
//   generateDesignConcept(imageBase64: string, brief: string)
//     -> { ok, image (base64), mimeType, model, savedTo, error }
//
// Sends the current screenshot (image-in) + the locked design tokens +
// a per-call redesign brief to the Gemini **image** model and returns a
// generated design concept image (image-out).
//
// This is a DIFFERENT model from critique_design ("gemini-3.1-pro" for text
// critique). Image generation requires "gemini-3-pro-image" (stable) with
// fallback to "gemini-3-pro-image-preview" (both valid per Google's docs).
//
// Response modality MUST be explicitly set to IMAGE — the default modality
// is text, and the image API will not return an image unless requested.
//
// EXPLORATORY ONLY — the returned image is a concept to react to, NOT a build
// spec. Do NOT generate code from it in the same step. ON-DEMAND ONLY (premium
// model) — never wire into a scheduled/batch job.
// ───────────────────────────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Minimal .env loader (no dotenv dependency). Loads qa-agent/.env so
// GOOGLE_API_KEY can be dropped in locally OR provided as a real env var.
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

export interface DesignConceptResult {
  ok: boolean;
  image?: string; // base64-encoded image
  mimeType?: string;
  model?: string;
  savedTo?: string;
  error?: string;
}

// ── Constants ──────────────────────────────────────────────────

const TOKENS_PATH = path.join(__dirname, 'design-tokens-context.md');
const OUT_DIR = path.join(__dirname, '.generated');

// Stable name first; preview is the fallback (both valid per Google docs).
const MODEL_FALLBACKS = ['gemini-3-pro-image', 'gemini-3-pro-image-preview'];

// ── Design tokens context ──────────────────────────────────────

function loadTokens(): string {
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error(`Design tokens context not found at ${TOKENS_PATH}`);
  }
  return fs.readFileSync(TOKENS_PATH, 'utf8');
}

// ── Helpers ────────────────────────────────────────────────────

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

function buildPrompt(brief: string): string {
  const tokens = loadTokens();
  return [
    'You are a senior fintech product designer. Redesign a SINGLE UI component so it matches a locked design system.',
    'Treat the attached screenshot as style/context anchoring only — you are producing a visual concept, not editing prose.',
    '',
    '=== LOCKED DESIGN SYSTEM ===',
    tokens,
    '=== END DESIGN SYSTEM ===',
    '',
    '=== REDESIGN BRIEF ===',
    brief || '(not provided)',
    '=== END BRIEF ===',
    '',
    'Produce ONE high-fidelity concept image of the redesigned component. Stay within the established canvas, accent color, and serif-italic display font — this is about layout and hierarchy boldness, not a new palette. Output the image only; do not add a text explanation.',
  ].join('\n');
}

interface GeminiPart {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
  text?: string;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message?: string; status?: string };
}

// ── Gemini API call (image generation) ─────────────────────────

async function callGeminiImage(
  imageBase64: string,
  brief: string,
  model: string
): Promise<{ image: string; mimeType: string }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY is not set (add it to the VPS environment or qa-agent/.env)');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(brief) },
          { inline_data: { mime_type: detectMime(imageBase64), data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      // Image generation requires this to be explicitly set — the default
      // modality is text, and the image API will not return an image otherwise.
      responseModalities: ['IMAGE'],
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });

  const data = (await resp.json().catch(() => ({}))) as GeminiResponse;

  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`Gemini API error (${model}): ${msg}`);
  }

  const parts = (data?.candidates ?? []).flatMap((c) => c?.content?.parts ?? []);
  for (const p of parts) {
    const inline: any = p?.inlineData ?? p?.inline_data;
    if (inline?.data) {
      return { image: inline.data, mimeType: inline.mimeType ?? inline.mime_type ?? 'image/png' };
    }
  }
  throw new Error('Gemini API returned no image content');
}

// ── Save ───────────────────────────────────────────────────────

function saveImage(imageBase64: string, mimeType: string): string {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  const file = path.join(OUT_DIR, `concept-${Date.now()}.${ext}`);
  fs.writeFileSync(file, Buffer.from(imageBase64, 'base64'));
  return file;
}

// ── The tool ───────────────────────────────────────────────────

export async function generateDesignConcept(
  imageBase64: string,
  brief: string,
  opts: { model?: string } = {}
): Promise<DesignConceptResult> {
  const img = (imageBase64 ?? '').trim();
  const desc = (brief ?? '').trim();

  if (!img) {
    return { ok: false, error: 'empty_image' };
  }
  if (!desc) {
    return { ok: false, error: 'empty_brief' };
  }

  const models = opts.model ? [opts.model] : MODEL_FALLBACKS;
  let lastErr = '';

  for (const model of models) {
    try {
      const { image, mimeType } = await callGeminiImage(img, desc, model);
      const savedTo = saveImage(image, mimeType);
      return { ok: true, image, mimeType, model, savedTo };
    } catch (err: any) {
      lastErr = err?.message ?? String(err);
      // If the stable name failed and a fallback remains, try it; otherwise report.
      if (models.length === 1) break;
    }
  }

  return { ok: false, error: lastErr };
}

// ── CLI entry point ────────────────────────────────────────────
// Usage:
//   npx ts-node generate-design-concept.ts <image_file.png> "<brief>"
//   npx ts-node generate-design-concept.ts --b64 <base64> "<brief>"
//   npx ts-node generate-design-concept.ts --stdin "<brief>"   (base64 piped via stdin)
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let imageBase64: string | null = null;
    let brief = '';

    if (args[0] === '--b64') {
      imageBase64 = args[1] ?? null;
      brief = args[2] ?? '';
    } else if (args[0] === '--stdin') {
      imageBase64 = fs.readFileSync(0, 'utf8').trim();
      brief = args[1] ?? '';
    } else if (args[0] && !args[0].startsWith('--')) {
      const file = args[0];
      if (fs.existsSync(file)) {
        imageBase64 = fs.readFileSync(file).toString('base64');
      } else {
        console.error(JSON.stringify({ ok: false, error: `image file not found: ${file}` }));
        process.exit(1);
      }
      brief = args[1] ?? '';
    } else {
      console.error('Usage: npx ts-node generate-design-concept.ts <image_file.png> "<brief>"');
      process.exit(1);
    }

    const result = await generateDesignConcept(imageBase64 as string, brief);
    // Strip the heavy base64 from stdout so logs stay sane; also write it to a file.
    const { image, ...meta } = result;
    if (result.ok && result.savedTo) {
      fs.writeFileSync(result.savedTo + '.b64', image as string);
    }
    console.log(JSON.stringify({ ...meta, imageBytes: image?.length ?? 0 }, null, 2));
    process.exit(result.ok ? 0 : 2);
  })().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
    process.exit(1);
  });
}
