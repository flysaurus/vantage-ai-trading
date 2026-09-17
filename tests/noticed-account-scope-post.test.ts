// ─── Scope guard: every noticed POST must carry its account scope ─────
//
// 2026-09-18 (Em): `context/PortfolioContext.tsx` posted the post-trade
// noticed re-check with NO `accountId`. The route defaults a missing scope to
// `'demo'`, so the pipeline ran under the DEMO account while carrying LIVE
// broker positions from the client — mis-attributed rows, the same
// contamination class as the July 24 demo data-integrity incident.
//
// A missing scope is a silent bug: nothing 500s, the feed still populates, the
// rows just land under the wrong account. So this test greps every client POST
// call site and fails if `accountId` is absent from the request body. It is a
// regex scan, not a runtime check — deliberately, so it runs offline.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOTS = ['components', 'context', 'hooks'];

/** Windows of source around each `/api/ai/noticed` reference. */
function noticedCallSites(): Array<{ file: string; snippet: string }> {
  const files = execSync(
    `grep -rl --include=*.ts --include=*.tsx "/api/ai/noticed" ${ROOTS.join(' ')} || true`,
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  const sites: Array<{ file: string; snippet: string }> = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const needle = '/api/ai/noticed';
    let i = src.indexOf(needle);
    while (i !== -1) {
      const after = src.slice(i + needle.length, i + needle.length + 8);
      // `/api/ai/noticed/dismiss` is item-scoped, not account-scoped.
      if (!after.startsWith('/dismiss')) {
        sites.push({ file, snippet: src.slice(i, i + 1600) });
      }
      i = src.indexOf(needle, i + needle.length);
    }
  }
  return sites;
}

describe('noticed POST call sites carry an account scope', () => {
  it('every client reference to /api/ai/noticed mentions accountId', () => {
    const sites = noticedCallSites();
    expect(sites.length).toBeGreaterThan(0);
    const missing = sites.filter((s) => !/accountId/.test(s.snippet));
    expect(missing.map((s) => s.file)).toEqual([]);
  });

  it('the post-trade re-check in PortfolioContext passes accountId explicitly', () => {
    const src = readFileSync('context/PortfolioContext.tsx', 'utf8');
    const idx = src.indexOf("fetch('/api/ai/noticed'");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 1600);
    expect(body).toMatch(/accountId:\s*activeAccountId/);
  });
});
