// ─── Test Runner — server data helpers ────────────────────────
//
// Server-only module. Uses the service-role Supabase client
// (createServerClient()) for every read/write — never import this from a
// client component. RLS on the four test_* tables is enabled with no
// policies, so the service role is the ONLY way in (see migration 076).
//
// The GitHub fail-path orchestrator (reportFailToGitHub) is best-effort:
// a GitHub failure must never take down a recorded run.

import { createServerClient } from '@/lib/supabase';
import {
  createGitHubClient,
  isSkipped,
  tcLabel,
  buildFailIssueBody,
  buildFailIssueLabels,
  buildFailIssueTitle,
  buildFailCommentBody,
  decideFailAction,
  type GitHubClient,
} from '@/lib/qa/github';

// ─── Types ────────────────────────────────────────────────────

export interface ParsedTestCase {
  tc_number: string;
  title: string;
  steps: string | null;
  expected_result: string | null;
  area: string | null;
}

export interface ParseTestCaseResult {
  cases: ParsedTestCase[];
  skipped: string[];
}

export interface TestCaseRow {
  id: string;
  tc_number: string;
  title: string;
  steps: string | null;
  expected_result: string | null;
  area: string | null;
  created_at: string;
}

export interface TestCycleRow {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  case_count?: number;
}

export interface CoverageRow {
  test_case_id: string;
  tc_number: string;
  title: string;
  result: 'pass' | 'fail' | 'not_run';
  tester_name: string | null;
  created_at: string | null;
}

export interface CoverageSummary {
  cycle_id: string;
  cycle_name: string;
  total: number;
  passed: number;
  failed: number;
  not_run: number;
  percent_passed: number;
  rows: CoverageRow[];
}

export interface RecordRunInput {
  caseId: string;
  cycleId: string;
  testerName?: string | null;
  result: 'pass' | 'fail';
  notes?: string | null;
  screenshotUrl?: string | null;
}

export interface ReportFailInput {
  tcNumber: string;
  title: string;
  cycleName?: string | null;
  testerName?: string | null;
  notes?: string | null;
  screenshotUrl?: string | null;
}

export type GitHubReportOutcome =
  | {
      ok: true;
      action: 'created' | 'commented' | 'commented_reopened';
      issueNumber: number;
      issueUrl: string;
    }
  | { ok: false; skipped?: boolean; reason: string };

// ─── Bulk-paste parser ────────────────────────────────────────
//
// Tolerant format (documented here, exercised by tests/test-runner-parse.test.ts):
//
//   • Blocks are separated by one OR MORE blank lines.
//   • The first non-empty line of a block must start with a TC number,
//     e.g. `TC-014`, `TC-014: title`, `TC-014 - title`, `TC-014. title`.
//     A bare `TC-014` is accepted (title becomes an empty string).
//   • Optional sections follow, each introduced by a key + colon on its own line:
//       `Steps:`  / `Expected:`  /  `Expected Result:`  /  `Area:`
//     The section body is the rest of that line plus every following line
//     until the next section key. `Steps`/`Expected` keep newlines; `Area`
//     collapses to a single line.
//   • Anything before the first section key is ignored.
//   • Blocks that don't start with a TC number are collected in `skipped`.
//   • TC numbers are normalised to upper-case (`tc-14` → `TC-14`).

const TC_LINE_RE = /^(TC-\d+)\s*(?:[:.\-–—]\s*)?(.*)$/i;
const SECTION_RE = /^(steps|expected(?:\s+result)?|area)\s*[:.]\s*(.*)$/i;

function sectionKeyFor(raw: string): 'steps' | 'expected_result' | 'area' | null {
  if (/^steps/i.test(raw)) return 'steps';
  if (/^expected/i.test(raw)) return 'expected_result';
  if (/^area/i.test(raw)) return 'area';
  return null;
}

export function parseTestCasePaste(text: string): ParseTestCaseResult {
  const result: ParseTestCaseResult = { cases: [], skipped: [] };
  if (!text || !text.trim()) return result;

  const normalized = text.replace(/\r\n?/g, '\n');
  // Split on a blank line (allowing stray whitespace on the "blank" line).
  const blocks = normalized.split(/\n\s*\n/);

  for (const rawBlock of blocks) {
    const lines = rawBlock.split('\n').map((l) => l.trim());
    const firstIdx = lines.findIndex((l) => l.length > 0);
    if (firstIdx === -1) continue;

    const firstLine = lines[firstIdx];
    const m = firstLine.match(TC_LINE_RE);
    if (!m) {
      result.skipped.push(firstLine);
      continue;
    }

    const tc_number = m[1].toUpperCase();
    const title = (m[2] || '').trim();

    const buckets: Record<'steps' | 'expected_result' | 'area', string[]> = {
      steps: [],
      expected_result: [],
      area: [],
    };
    let current: 'steps' | 'expected_result' | 'area' | null = null;

    for (const line of lines.slice(firstIdx + 1)) {
      const sec = line.match(SECTION_RE);
      if (sec) {
        current = sectionKeyFor(sec[1]);
        if (current && sec[2]) buckets[current].push(sec[2].trim());
        continue;
      }
      if (current === null) continue; // preamble — ignore
      buckets[current].push(line);
    }

    const steps = buckets.steps.join('\n').trim();
    const expected = buckets.expected_result.join('\n').trim();
    const area = buckets.area.join(' ').trim();

    result.cases.push({
      tc_number,
      title,
      steps: steps ? steps : null,
      expected_result: expected ? expected : null,
      area: area ? area : null,
    });
  }

  return result;
}

// ─── DB helpers ───────────────────────────────────────────────

function sb() {
  return createServerClient() as any;
}

export async function listTestCases(): Promise<TestCaseRow[]> {
  const { data, error } = await sb()
    .from('test_cases')
    .select('*')
    .order('tc_number', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as TestCaseRow[];
}

export async function listCycles(): Promise<TestCycleRow[]> {
  const client = sb();
  const { data: cycles, error } = await client
    .from('test_cycles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const { data: links } = await client.from('test_cycle_cases').select('cycle_id');
  const counts = new Map<string, number>();
  for (const l of links || []) {
    counts.set(l.cycle_id, (counts.get(l.cycle_id) || 0) + 1);
  }

  return (cycles || []).map((c: any) => ({ ...c, case_count: counts.get(c.id) || 0 }));
}

export async function createCycle(name: string, caseIds: string[]): Promise<TestCycleRow> {
  const client = sb();
  const { data: cycle, error } = await client
    .from('test_cycles')
    .insert({ name, active: true })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  const ids = (caseIds || []).filter(Boolean);
  if (ids.length) {
    const rows = ids.map((test_case_id) => ({ cycle_id: cycle.id, test_case_id }));
    const { error: linkErr } = await client.from('test_cycle_cases').insert(rows);
    if (linkErr) throw new Error(linkErr.message);
  }

  return { ...cycle, case_count: ids.length } as TestCycleRow;
}

export async function getCycleWithCases(
  cycleId: string,
): Promise<{ cycle: TestCycleRow | null; cases: TestCaseRow[] }> {
  const client = sb();
  const { data: cycle } = await client
    .from('test_cycles')
    .select('*')
    .eq('id', cycleId)
    .maybeSingle();
  if (!cycle) return { cycle: null, cases: [] };

  const { data: links } = await client
    .from('test_cycle_cases')
    .select('test_case_id')
    .eq('cycle_id', cycleId);
  const ids = (links || []).map((l: any) => l.test_case_id);
  if (!ids.length) return { cycle, cases: [] };

  const { data: cases } = await client
    .from('test_cases')
    .select('*')
    .in('id', ids)
    .order('tc_number', { ascending: true });

  return { cycle, cases: (cases || []) as TestCaseRow[] };
}

export async function getCoverage(cycleId: string): Promise<CoverageSummary> {
  const client = sb();
  const { cycle, cases } = await getCycleWithCases(cycleId);

  const { data: runs } = await client
    .from('test_runs')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('created_at', { ascending: false });

  // Latest run per case (runs are already newest-first).
  const latest = new Map<string, any>();
  for (const r of runs || []) {
    if (!latest.has(r.test_case_id)) latest.set(r.test_case_id, r);
  }

  const rows: CoverageRow[] = cases.map((c) => {
    const run = latest.get(c.id);
    return {
      test_case_id: c.id,
      tc_number: c.tc_number,
      title: c.title,
      result: run ? (run.result as 'pass' | 'fail') : 'not_run',
      tester_name: run?.tester_name ?? null,
      created_at: run?.created_at ?? null,
    };
  });

  const passed = rows.filter((r) => r.result === 'pass').length;
  const failed = rows.filter((r) => r.result === 'fail').length;
  const not_run = rows.filter((r) => r.result === 'not_run').length;
  const total = rows.length;

  return {
    cycle_id: cycleId,
    cycle_name: cycle?.name || 'Unknown cycle',
    total,
    passed,
    failed,
    not_run,
    percent_passed: total ? Math.round((passed / total) * 100) : 0,
    rows,
  };
}

export async function recordRun(input: RecordRunInput): Promise<any> {
  const { data, error } = await sb()
    .from('test_runs')
    .insert({
      test_case_id: input.caseId,
      cycle_id: input.cycleId,
      tester_name: input.testerName || null,
      result: input.result,
      notes: input.notes || null,
      screenshot_url: input.screenshotUrl || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ─── GitHub fail-path orchestrator ────────────────────────────
//
// label `tc:{tc_number}` → existing issue? comment + reopen if closed
//                        : else create a new issue.
// Best-effort: any GitHub failure is returned as `{ ok:false }` and the
// caller still keeps the recorded run.

export async function reportFailToGitHub(
  input: ReportFailInput,
  client?: GitHubClient,
): Promise<GitHubReportOutcome> {
  const gh = client || createGitHubClient();
  const label = tcLabel(input.tcNumber);

  try {
    // Pull Steps / Expected from the stored case (best effort).
    let steps: string | null = null;
    let expectedResult: string | null = null;
    try {
      const { data: tc } = await sb()
        .from('test_cases')
        .select('steps, expected_result')
        .eq('tc_number', input.tcNumber)
        .maybeSingle();
      steps = tc?.steps ?? null;
      expectedResult = tc?.expected_result ?? null;
    } catch {
      /* ignore — case lookup is optional context */
    }

    const payload = {
      tcNumber: input.tcNumber,
      title: input.title,
      steps,
      expectedResult,
      notes: input.notes ?? null,
      screenshotUrl: input.screenshotUrl ?? null,
      cycleName: input.cycleName ?? null,
      testerName: input.testerName ?? null,
    };

    const found = await gh.findIssueByLabel(label);
    if (isSkipped(found)) return { ok: false, skipped: true, reason: found.reason };

    const existing = found.issue;
    const action = decideFailAction(existing);

    if (action === 'create') {
      const created = await gh.createIssue({
        title: buildFailIssueTitle(input.tcNumber, input.title),
        body: buildFailIssueBody(payload),
        labels: buildFailIssueLabels(input.tcNumber),
      });
      if (isSkipped(created)) return { ok: false, skipped: true, reason: created.reason };
      return {
        ok: true,
        action: 'created',
        issueNumber: created.issue.number,
        issueUrl: created.issue.html_url,
      };
    }

    // action === 'comment' | 'comment_and_reopen'
    const issueNumber = existing!.number;
    const commented = await gh.commentOnIssue(issueNumber, buildFailCommentBody(payload));
    if (isSkipped(commented)) return { ok: false, skipped: true, reason: commented.reason };

    let reopened = false;
    if (action === 'comment_and_reopen') {
      const r = await gh.reopenIssue(issueNumber);
      reopened = !isSkipped(r) && r.issue.state === 'open';
    }

    return {
      ok: true,
      action: reopened ? 'commented_reopened' : 'commented',
      issueNumber,
      issueUrl: existing!.html_url,
    };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'GitHub reporting failed' };
  }
}
