// ─── Public Test Runner: record a run ─────────────────────────
// POST /api/test-runner/run  (multipart/form-data)
//
// PUBLIC — deliberately no auth. Fields:
//   caseId, cycleId, testerName, result ('pass'|'fail'), notes?, screenshot? (File)
//
// Order of operations:
//   1. validate
//   2. upload the screenshot (if any) to the public `test-screenshots` bucket
//   3. ALWAYS insert the test_runs row
//   4. on failure, report to GitHub (best-effort — never fails the request)
//   5. on pass, no GitHub call
//
// A GitHub failure must NOT fail the request: the response carries the run
// row plus a `github` status object.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { recordRun, reportFailToGitHub } from '@/lib/qa/test-runner';

export const runtime = 'nodejs';

const BUCKET = 'test-screenshots';

function safeExt(name: string | undefined, mime: string | undefined): string {
  const fromName = (name || '').split('.').pop()?.toLowerCase() || '';
  const cleaned = fromName.replace(/[^a-z0-9]/g, '');
  if (cleaned && cleaned.length <= 5) return cleaned;
  if (mime?.includes('png')) return 'png';
  if (mime?.includes('jpeg') || mime?.includes('jpg')) return 'jpg';
  if (mime?.includes('webp')) return 'webp';
  return 'png';
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();

    const caseId = String(form.get('caseId') || '').trim();
    const cycleId = String(form.get('cycleId') || '').trim();
    const testerName = String(form.get('testerName') || '').trim();
    const result = String(form.get('result') || '').trim();
    const notes = String(form.get('notes') || '');

    if (!caseId || !cycleId) {
      return NextResponse.json({ error: 'caseId and cycleId are required.' }, { status: 400 });
    }
    if (result !== 'pass' && result !== 'fail') {
      return NextResponse.json({ error: "result must be 'pass' or 'fail'." }, { status: 400 });
    }

    const sb = createServerClient() as any;

    // Context for the GitHub path + the screenshot filename.
    const { data: tc } = await sb
      .from('test_cases')
      .select('id, tc_number, title')
      .eq('id', caseId)
      .maybeSingle();
    const { data: cycle } = await sb
      .from('test_cycles')
      .select('id, name')
      .eq('id', cycleId)
      .maybeSingle();

    // ── 2. Screenshot upload (optional; best-effort) ──
    let screenshotUrl: string | null = null;
    let uploadError: string | null = null;
    const file = form.get('screenshot');
    if (file && typeof file === 'object' && typeof (file as any).arrayBuffer === 'function') {
      const f = file as File;
      if (f.size > 0) {
        const ext = safeExt(f.name, f.type);
        const path = `${cycleId}/${tc?.tc_number || caseId}-${Date.now()}.${ext}`;
        try {
          const buf = Buffer.from(await f.arrayBuffer());
          const { error } = await sb.storage
            .from(BUCKET)
            .upload(path, buf, { contentType: f.type || 'image/png', upsert: false });
          if (error) {
            uploadError = error.message;
          } else {
            screenshotUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
          }
        } catch (e: any) {
          uploadError = e?.message || 'upload failed';
        }
      }
    }

    // ── 3. Always record the run ──
    let run: any;
    try {
      run = await recordRun({
        caseId,
        cycleId,
        testerName,
        result: result as 'pass' | 'fail',
        notes,
        screenshotUrl,
      });
    } catch (e: any) {
      console.error('[test-runner/run] insert failed:', e?.message);
      return NextResponse.json({ error: e?.message || 'Failed to record run' }, { status: 500 });
    }

    // ── 4/5. GitHub fail path (best-effort) ──
    let github: any = null;
    if (result === 'fail') {
      github = await reportFailToGitHub(
        {
          tcNumber: tc?.tc_number || '',
          title: tc?.title || '',
          cycleName: cycle?.name ?? null,
          testerName,
          notes,
          screenshotUrl,
        },
      );
    }

    return NextResponse.json({
      run,
      screenshot_url: screenshotUrl,
      upload_error: uploadError,
      github,
    });
  } catch (err: any) {
    console.error('[test-runner/run] POST error:', err?.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
