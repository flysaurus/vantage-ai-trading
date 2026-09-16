// ─── Test Runner: GitHub fail-path payloads + orchestration ────
// Pure payload builders plus reportFailToGitHub() driven by a MOCKED client.
// No network, no Supabase. Run with:
//   npx vitest run tests/test-runner-github.test.ts

import { describe, it, expect, vi } from 'vitest';
import {
  buildFailIssueTitle,
  buildFailIssueBody,
  buildFailIssueLabels,
  buildFailCommentBody,
  buildIssueSearchQuery,
  decideFailAction,
  resolveRepo,
  tcLabel,
  type GitHubClient,
  type GitHubIssueSummary,
} from '@/lib/qa/github';
import { reportFailToGitHub } from '@/lib/qa/test-runner';

// ─── Payload builders ─────────────────────────────────────────

describe('fail-path payload builders', () => {
  it('builds the issue title', () => {
    expect(buildFailIssueTitle('TC-014', 'Login with a valid email')).toBe(
      '[TC-014] Login with a valid email — FAIL',
    );
  });

  it('builds the labels (general vs test-case distinguishable)', () => {
    expect(buildFailIssueLabels('TC-014')).toEqual([
      'source:test-case',
      'type:bug',
      'tc:TC-014',
    ]);
    expect(tcLabel('TC-014')).toBe('tc:TC-014');
  });

  it('builds an issue body with steps, expected, notes and screenshot markdown', () => {
    const body = buildFailIssueBody({
      tcNumber: 'TC-014',
      title: 'Login',
      steps: '1. open /login',
      expectedResult: 'lands on dashboard',
      notes: 'got a 500 instead',
      screenshotUrl: 'https://cdn.example/shot.png',
      cycleName: 'Pre-release smoke',
      testerName: 'Em',
    });
    expect(body).toContain('TC-014 — Login');
    expect(body).toContain('1. open /login');
    expect(body).toContain('lands on dashboard');
    expect(body).toContain('got a 500 instead');
    expect(body).toContain('![screenshot](https://cdn.example/shot.png)');
    expect(body).toContain('cycle: Pre-release smoke');
    expect(body).toContain('tester: Em');
  });

  it('omits the screenshot block when no screenshot exists', () => {
    const body = buildFailIssueBody({ tcNumber: 'TC-015', title: 'No shot', notes: 'nope' });
    expect(body).not.toContain('![screenshot]');
    expect(body).toContain('_none provided_');
  });

  it('builds a comment body with cycle, tester, notes and screenshot', () => {
    const body = buildFailCommentBody({
      tcNumber: 'TC-014',
      title: 'Login',
      cycleName: 'Smoke',
      testerName: 'Em',
      notes: 'still broken',
      screenshotUrl: 'https://cdn.example/shot.png',
    });
    expect(body).toContain('❌ Still failing — TC-014: Login');
    expect(body).toContain('Cycle: Smoke');
    expect(body).toContain('Tester: Em');
    expect(body).toContain('Notes: still broken');
    expect(body).toContain('![screenshot](https://cdn.example/shot.png)');
  });
});

// ─── Config helpers ───────────────────────────────────────────

describe('github config helpers', () => {
  it('builds a state-agnostic search query', () => {
    expect(buildIssueSearchQuery('me/repo', 'tc:TC-014')).toBe(
      'repo:me/repo is:issue label:"tc:TC-014"',
    );
  });

  it('parses owner/repo and defaults when blank', () => {
    const r = resolveRepo('flysaurus/vantage-ai-trading');
    expect(r.owner).toBe('flysaurus');
    expect(r.repo).toBe('vantage-ai-trading');
    expect(r.full).toBe('flysaurus/vantage-ai-trading');
  });
});

// ─── Decision logic ───────────────────────────────────────────

const closedIssue: GitHubIssueSummary = {
  number: 5, title: 'x', state: 'closed', html_url: 'https://github.com/x/5', labels: [],
};
const openIssue: GitHubIssueSummary = {
  number: 5, title: 'x', state: 'open', html_url: 'https://github.com/x/5', labels: [],
};

describe('decideFailAction', () => {
  it('creates when no issue exists', () => {
    expect(decideFailAction(null)).toBe('create');
    expect(decideFailAction(undefined)).toBe('create');
  });
  it('comments on an open issue', () => {
    expect(decideFailAction(openIssue)).toBe('comment');
  });
  it('comments + reopens a closed issue', () => {
    expect(decideFailAction(closedIssue)).toBe('comment_and_reopen');
  });
});

// ─── Orchestrator (mocked client) ─────────────────────────────

function makeClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    findIssueByLabel: vi.fn().mockResolvedValue({ skipped: false, issue: null }),
    createIssue: vi.fn().mockResolvedValue({
      skipped: false,
      issue: { number: 42, html_url: 'https://github.com/x/42', state: 'open', title: 't', labels: [] },
    }),
    commentOnIssue: vi.fn().mockResolvedValue({
      skipped: false,
      comment: { id: 1, html_url: 'https://github.com/x/42#c1' },
    }),
    reopenIssue: vi.fn().mockResolvedValue({ skipped: false, issue: openIssue }),
    closeIssue: vi.fn(),
    ensureLabels: vi.fn(),
    ...overrides,
  };
}

const input = {
  tcNumber: 'TC-014',
  title: 'Login',
  cycleName: 'Smoke',
  testerName: 'Em',
  notes: 'broke',
  screenshotUrl: 'https://cdn.example/shot.png',
};

describe('reportFailToGitHub', () => {
  it('creates a new issue when none exists for the TC', async () => {
    const client = makeClient();
    const outcome = await reportFailToGitHub(input, client);

    expect(client.findIssueByLabel).toHaveBeenCalledWith('tc:TC-014');
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    const arg = (client.createIssue as any).mock.calls[0][0];
    expect(arg.title).toBe('[TC-014] Login — FAIL');
    expect(arg.labels).toEqual(['source:test-case', 'type:bug', 'tc:TC-014']);
    expect(arg.body).toContain('![screenshot](https://cdn.example/shot.png)');
    expect(outcome).toEqual({
      ok: true,
      action: 'created',
      issueNumber: 42,
      issueUrl: 'https://github.com/x/42',
    });
  });

  it('comments on an existing OPEN issue (no reopen)', async () => {
    const client = makeClient({
      findIssueByLabel: vi.fn().mockResolvedValue({ skipped: false, issue: openIssue }),
    });
    const outcome = await reportFailToGitHub(input, client);

    expect(client.createIssue).not.toHaveBeenCalled();
    expect(client.commentOnIssue).toHaveBeenCalledTimes(1);
    expect(client.reopenIssue).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: true,
      action: 'commented',
      issueNumber: 5,
      issueUrl: 'https://github.com/x/5',
    });
  });

  it('comments AND reopens a CLOSED issue', async () => {
    const client = makeClient({
      findIssueByLabel: vi.fn().mockResolvedValue({ skipped: false, issue: closedIssue }),
    });
    const outcome = await reportFailToGitHub(input, client);

    expect(client.commentOnIssue).toHaveBeenCalledTimes(1);
    expect(client.reopenIssue).toHaveBeenCalledWith(5);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.action).toBe('commented_reopened');
  });

  it('returns a skipped outcome when the token is missing', async () => {
    const client = makeClient({
      findIssueByLabel: vi
        .fn()
        .mockResolvedValue({ skipped: true, reason: 'GITHUB_TOKEN not configured' }),
    });
    const outcome = await reportFailToGitHub(input, client);
    expect(outcome).toEqual({
      ok: false,
      skipped: true,
      reason: 'GITHUB_TOKEN not configured',
    });
  });

  it('never throws when GitHub errors mid-flight', async () => {
    const client = makeClient({
      createIssue: vi.fn().mockRejectedValue(new Error('GitHub 500: boom')),
    });
    const outcome = await reportFailToGitHub(input, client);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain('boom');
  });
});
