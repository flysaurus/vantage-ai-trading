// ─── Schema guard: PostgREST column traps ─────────────────────
//
// Both silent-failure bugs in this Part B arc came from filtering on a column
// that does not exist. PostgREST answers those with HTTP 400 / code 42703, the
// callers log a warning and continue — so the feature is simply off, with no
// visible symptom in dev:
//
//   * `position_lots.connection_id`  → lots were never purged on disconnect.
//   * `broker_accounts.user_id`      → the registry lookup failed, so lot
//                                      writes stayed connection-scoped (which
//                                      BLENDS sibling sub-accounts on a shared
//                                      login — the exact thing step 5 forbids).
//
// This test greps the call sites so a third one can never ship silently.
// It is a regex scan, not a database check — deliberately, so it runs offline.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOTS = ['app', 'lib', 'scripts'];

function sourceFiles(): string[] {
  const out = execSync(
    `grep -rl --include=*.ts --include=*.tsx --include=*.mjs "from('" ${ROOTS.join(' ')} || true`,
    { encoding: 'utf8' },
  ).trim();
  return out ? out.split('\n').filter((f) => !f.includes('node_modules')) : [];
}

/** Text of the PostgREST builder chain starting at `from('<table>')`. */
function chainsFor(src: string, table: string): string[] {
  const chains: string[] = [];
  const needle = `.from('${table}')`;
  let i = src.indexOf(needle);
  while (i !== -1) {
    // The chain ends at the next `.from(` (new query) or a blank line.
    const rest = src.slice(i + needle.length);
    const nextFrom = rest.indexOf(".from('");
    const end = nextFrom === -1 ? rest.length : nextFrom;
    chains.push(rest.slice(0, end));
    i = src.indexOf(needle, i + needle.length);
  }
  return chains;
}

describe('PostgREST schema guard', () => {
  const files = sourceFiles();

  it('finds source files to scan (sanity)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("never filters broker_accounts by user_id (column does not exist — 42703)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const chain of chainsFor(src, 'broker_accounts')) {
        if (/\.eq\(\s*'user_id'/.test(chain)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never filters position_lots by connection_id (column does not exist — 42703)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const chain of chainsFor(src, 'position_lots')) {
        if (/\.eq\(\s*'connection_id'/.test(chain)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never filters broker_connections by broker / broker_name (label column is brokerage_slug)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const chain of chainsFor(src, 'broker_connections')) {
        if (/\.(eq|select|order|ilike|like)\(\s*'(broker|broker_name)'/.test(chain)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('broker_accounts scoping always goes through connection_id (the only user-owned key it has)', () => {
    // Every broker_accounts chain must scope by connection_id or by id.
    const unscoped: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const chain of chainsFor(src, 'broker_accounts')) {
        if (chain.includes('insert(') || chain.includes('upsert(') || chain.includes('delete(')) continue;
        const scoped =
          /\.eq\(\s*'connection_id'/.test(chain) ||
          // A bulk read scoped to the caller's OWN connection ids (already
          // filtered by user_id on broker_connections) is equally safe.
          /\.in\(\s*'connection_id'/.test(chain) ||
          /\.eq\(\s*'id'/.test(chain) ||
          /\.in\(\s*'id'/.test(chain);
        if (!scoped) {
          unscoped.push(f);
        }
      }
    }
    expect(unscoped).toEqual([]);
  });
});
