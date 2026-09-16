// ─── GitHub REST wrapper for QA test-case reporting ───────────
//
// DELIBERATE DEVIATION from the usual stack: there is no octokit
// dependency in this repo, so this module talks to the GitHub REST API
// with plain `fetch`. Keep it small and dependency-free.
//
// Auth:   GITHUB_TOKEN          (a PAT / fine-grained token with `issues:write`)
// Repo:   GITHUB_REPO           (optional; defaults to flysaurus/vantage-ai-trading)
//
// Graceful degradation: if GITHUB_TOKEN is missing, every function returns
// `{ skipped: true, reason }` instead of throwing. Callers must ALWAYS still
// persist their own data (e.g. the test_runs row) — the GitHub side is
// best-effort and must never take down a run.

const DEFAULT_REPO = 'flysaurus/vantage-ai-trading';
const API_BASE = 'https://api.github.com';

// ─── Types ────────────────────────────────────────────────────

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: 'open' | 'closed' | string;
  html_url: string;
  labels: Array<string | { name?: string | null }>;
  comments?: number;
}

export interface GitHubComment {
  id: number;
  html_url: string;
}

export interface SkippedResult {
  skipped: true;
  reason: string;
}

export type GitHubResult<T> = SkippedResult | ({ skipped: false } & T);

export function isSkipped<T>(r: GitHubResult<T>): r is SkippedResult {
  return (r as SkippedResult).skipped === true;
}

export interface GitHubClient {
  findIssueByLabel(label: string): Promise<GitHubResult<{ issue: GitHubIssueSummary | null }>>;
  createIssue(input: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<GitHubResult<{ issue: GitHubIssueSummary }>>;
  commentOnIssue(issueNumber: number, body: string): Promise<GitHubResult<{ comment: GitHubComment }>>;
  reopenIssue(issueNumber: number): Promise<GitHubResult<{ issue: GitHubIssueSummary }>>;
  closeIssue(
    issueNumber: number,
    reason?: 'completed' | 'not_planned',
  ): Promise<GitHubResult<{ issue: GitHubIssueSummary }>>;
  ensureLabels(
    labels: string[],
  ): Promise<GitHubResult<{ created: string[]; existing: string[] }>>;
}

// ─── Config helpers (pure — safe to unit test) ────────────────

export function resolveRepo(full?: string | null): { owner: string; repo: string; full: string } {
  const raw = (full || process.env.GITHUB_REPO || DEFAULT_REPO).trim();
  const [owner, repo] = raw.split('/');
  return { owner, repo, full: `${owner}/${repo}` };
}

export function buildIssueSearchQuery(repoFull: string, label: string): string {
  // `is:issue` + no state filter → covers BOTH open and closed issues.
  return `repo:${repoFull} is:issue label:"${label}"`;
}

export function labelName(l: string | { name?: string | null }): string {
  return typeof l === 'string' ? l : (l?.name || '');
}

// ─── Pure payload builders (fail path) ────────────────────────

export const FAIL_ISSUE_BASE_LABELS = ['source:test-case', 'type:bug'] as const;

export function tcLabel(tcNumber: string): string {
  return `tc:${tcNumber}`;
}

export function buildFailIssueLabels(tcNumber: string): string[] {
  return [...FAIL_ISSUE_BASE_LABELS, tcLabel(tcNumber)];
}

export function buildFailIssueTitle(tcNumber: string, title: string): string {
  return `[${tcNumber}] ${title} — FAIL`;
}

export interface FailPayloadInput {
  tcNumber: string;
  title: string;
  steps?: string | null;
  expectedResult?: string | null;
  notes?: string | null;
  screenshotUrl?: string | null;
  cycleName?: string | null;
  testerName?: string | null;
}

function orNone(v?: string | null): string {
  return v && v.trim() ? v.trim() : '_none provided_';
}

export function buildFailIssueBody(input: FailPayloadInput): string {
  const lines: string[] = [];
  lines.push(`### Test Case`);
  lines.push(`${input.tcNumber} — ${input.title || '(untitled)'}`);
  lines.push('');
  lines.push(`### Steps`);
  lines.push(orNone(input.steps));
  lines.push('');
  lines.push(`### Expected Result`);
  lines.push(orNone(input.expectedResult));
  lines.push('');
  lines.push(`### Actual / Notes`);
  lines.push(orNone(input.notes));
  if (input.screenshotUrl) {
    lines.push('');
    lines.push(`### Screenshot`);
    lines.push(`![screenshot](${input.screenshotUrl})`);
  }
  lines.push('');
  lines.push('---');
  lines.push(
    `_Reported via Vantage Test Runner · cycle: ${orNone(input.cycleName)} · tester: ${orNone(input.testerName)}_`,
  );
  return lines.join('\n');
}

export function buildFailCommentBody(input: FailPayloadInput): string {
  const lines: string[] = [];
  lines.push(`❌ Still failing — ${input.tcNumber}${input.title ? `: ${input.title}` : ''}`);
  lines.push('');
  lines.push(`- Cycle: ${orNone(input.cycleName)}`);
  lines.push(`- Tester: ${orNone(input.testerName)}`);
  lines.push(`- Notes: ${orNone(input.notes)}`);
  if (input.screenshotUrl) {
    lines.push('');
    lines.push(`![screenshot](${input.screenshotUrl})`);
  }
  return lines.join('\n');
}

// Decision helper: given the existing label-matched issue (or none), decide
// whether to create, comment, or comment + reopen. Pure — unit tested.
export type FailAction = 'create' | 'comment' | 'comment_and_reopen';

export function decideFailAction(existing: GitHubIssueSummary | null | undefined): FailAction {
  if (!existing) return 'create';
  return existing.state === 'closed' ? 'comment_and_reopen' : 'comment';
}

// ─── HTTP client ──────────────────────────────────────────────

class GitHubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

function token(): string | null {
  const t = process.env.GITHUB_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

const SKIP_REASON = 'GITHUB_TOKEN not configured — skipping GitHub reporting';

async function ghFetch(path: string, init: RequestInit = {}): Promise<any> {
  const t = token();
  if (!t) throw new GitHubApiError(SKIP_REASON, 0);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new GitHubApiError(`GitHub ${res.status}: ${detail || res.statusText}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function createGitHubClient(): GitHubClient {
  const { owner, repo, full } = resolveRepo();

  async function guarded<T>(fn: () => Promise<T>): Promise<GitHubResult<T>> {
    if (!token()) return { skipped: true, reason: SKIP_REASON };
    const data = await fn();
    return { skipped: false, ...(data as object) } as GitHubResult<T>;
  }

  return {
    async findIssueByLabel(label) {
      return guarded(async () => {
        const q = buildIssueSearchQuery(full, label);
        const data = await ghFetch(
          `/search/issues?q=${encodeURIComponent(q)}&per_page=1`,
        );
        const first: GitHubIssueSummary | null =
          data?.items && data.items.length ? data.items[0] : null;
        return { issue: first };
      });
    },

    async createIssue({ title, body, labels }) {
      return guarded(async () => {
        const issue = await ghFetch(`/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          body: JSON.stringify({ title, body, labels }),
        });
        return { issue: issue as GitHubIssueSummary };
      });
    },

    async commentOnIssue(issueNumber, body) {
      return guarded(async () => {
        const comment = await ghFetch(
          `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
          { method: 'POST', body: JSON.stringify({ body }) },
        );
        return { comment: comment as GitHubComment };
      });
    },

    async reopenIssue(issueNumber) {
      return guarded(async () => {
        const issue = await ghFetch(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'open' }),
        });
        return { issue: issue as GitHubIssueSummary };
      });
    },

    async closeIssue(issueNumber, reason = 'completed') {
      return guarded(async () => {
        const issue = await ghFetch(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'closed', state_reason: reason }),
        });
        return { issue: issue as GitHubIssueSummary };
      });
    },

    async ensureLabels(labels) {
      return guarded(async () => {
        const created: string[] = [];
        const existing: string[] = [];
        for (const name of labels) {
          try {
            await ghFetch(`/repos/${owner}/${repo}/labels`, {
              method: 'POST',
              body: JSON.stringify({ name, color: '0366d6' }),
            });
            created.push(name);
          } catch (e: any) {
            // 422 = label already exists → fine.
            if (e instanceof GitHubApiError && e.status === 422) {
              existing.push(name);
            } else {
              throw e;
            }
          }
        }
        return { created, existing };
      });
    },
  };
}

export { GitHubApiError };
