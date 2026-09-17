// ─── BugPin tester gate (is_tester, migration 079) ──────────────────────────
// The BugPin bug-report widget must be rendered for DESIGNATED TESTERS ONLY.
// Three layers are covered here:
//   1. lib/tester/bugpin.ts   — the predicate (fails closed)
//   2. /api/auth/me           — the flag the client gates on
//   3. /api/admin/users       — the per-user toggle that sets it
//
// Fail-closed matters: a missing column (migration not applied), a failed read,
// or a logged-out user must all resolve to "false", never "render the widget".

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted harness ─────────────────────────────────────────

const h = vi.hoisted(() => ({
  authUser: { id: 'u-1', email: 'tester@example.com' } as any,
  authError: null as any,
  adminUser: { id: 'a-1', email: 'admin@example.com' } as any,
  adminError: null as any,

  /** public.users row returned to /api/auth/me (select '*') */
  meRow: null as any,
  meError: null as any,

  /** public.users row returned to the toggle handler */
  toggleRow: null as any,
  toggleSelectError: null as any,

  /** rows returned to the admin GET list */
  listRows: [] as any[],
  /** simulate migration 079 not yet applied */
  testerColumnMissing: false,

  updateError: null as any,
  updateCalls: [] as any[],
  auditInserts: [] as any[],
  selectCols: [] as string[],
}));

vi.mock('@/lib/auth/get-server-user', () => ({
  requireAuth: async () => ({ authUser: h.authUser, authError: h.authError }),
}));

vi.mock('@/lib/auth/admin-check', () => ({
  requireAdmin: async () => ({ adminUser: h.adminUser, adminError: h.adminError }),
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: (table: string) => makeChain(table),
    auth: { admin: { signOut: async () => ({ error: null }) } },
  }),
}));

// ── chainable, awaitable PostgREST stub ─────────────────────

function makeChain(table: string): any {
  const ops: string[] = [];
  let cols: string | null = null;
  const opArgs: Record<string, any[]> = {};

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        // Awaiting the chain resolves the query.
        return (resolve: (v: any) => void, reject: (e: any) => void) => {
          try {
            resolve(run());
          } catch (e) {
            reject(e);
          }
        };
      }
      return (...args: any[]) => {
        ops.push(prop);
        opArgs[prop] = args;
        if (prop === 'select') cols = args[0] ?? null;
        return chain;
      };
    },
  });

  function run() {
    if (cols) h.selectCols.push(`${table}:${cols}`);

    if (table === 'users' && ops.includes('update')) {
      const patch = opArgs.update?.[0] ?? {};
      h.updateCalls.push(patch);
      return { data: null, error: h.updateError };
    }

    if (table === 'admin_audit_log' && ops.includes('insert')) {
      h.auditInserts.push(opArgs.insert?.[0]);
      return { data: null, error: null };
    }

    if (table === 'users' && ops.includes('select')) {
      // toggle handler reads a single row by id
      if (ops.includes('maybeSingle') && cols === 'id, is_tester') {
        return { data: h.toggleRow, error: h.toggleSelectError };
      }
      // /api/auth/me reads the whole profile
      if (ops.includes('maybeSingle') && cols === '*') {
        return { data: h.meRow, error: h.meError };
      }
      // admin list
      if (h.testerColumnMissing && (cols || '').includes('is_tester')) {
        return { data: null, error: { message: 'column users.is_tester does not exist' } };
      }
      return { data: h.listRows, error: null };
    }

    // unrelated tables used by the admin list aggregation
    return { data: [], error: null };
  }

  return chain;
}

import { NextRequest, NextResponse } from 'next/server';
import { GET as meGET } from '@/app/api/auth/me/route';
import { GET as adminUsersGET, PUT as adminUsersPUT } from '@/app/api/admin/users/route';
import { isTesterProfile, bugpinConfigured } from '@/lib/tester/bugpin';

const REQ = new NextRequest('https://example.test/api/admin/users?limit=10');

function put(body: Record<string, unknown>) {
  return new NextRequest('https://example.test/api/admin/users', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  h.authUser = { id: 'u-1', email: 'tester@example.com' };
  h.authError = null;
  h.adminUser = { id: 'a-1', email: 'admin@example.com' };
  h.adminError = null;
  h.meRow = null;
  h.meError = null;
  h.toggleRow = null;
  h.toggleSelectError = null;
  h.listRows = [];
  h.testerColumnMissing = false;
  h.updateError = null;
  h.updateCalls = [];
  h.auditInserts = [];
  h.selectCols = [];
});

// ── 1. predicate ────────────────────────────────────────────

describe('isTesterProfile (fail closed)', () => {
  it('is true only for an explicit is_tester === true', () => {
    expect(isTesterProfile({ is_tester: true })).toBe(true);
  });

  it('is false for false, missing column, null user — never truthy by accident', () => {
    expect(isTesterProfile({ is_tester: false })).toBe(false);
    expect(isTesterProfile({})).toBe(false); // migration 079 not applied yet
    expect(isTesterProfile({ is_tester: 'true' })).toBe(false); // string != boolean
    expect(isTesterProfile({ is_tester: 1 })).toBe(false);
    expect(isTesterProfile(null)).toBe(false);
    expect(isTesterProfile(undefined)).toBe(false);
  });

  it('has an embed src + api key configured', () => {
    expect(bugpinConfigured()).toBe(true);
  });
});

// ── 2. /api/auth/me ─────────────────────────────────────────

describe('GET /api/auth/me — is_tester passthrough', () => {
  it('returns is_tester true for a flagged tester', async () => {
    h.meRow = { id: 'u-1', tier: 'demo', is_tester: true };
    const res = await meGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.user.is_tester).toBe(true);
  });

  it('returns is_tester false for a normal user', async () => {
    h.meRow = { id: 'u-1', tier: 'demo', is_tester: false };
    const json = await (await meGET()).json();
    expect(json.user.is_tester).toBe(false);
  });

  it('returns is_tester false when the column is missing (migration 079 pending)', async () => {
    h.meRow = { id: 'u-1', tier: 'demo' };
    const json = await (await meGET()).json();
    expect(json.user.is_tester).toBe(false);
  });

  it('stays 401 for an unauthenticated caller', async () => {
    h.authUser = null;
    h.authError = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const res = await meGET();
    expect(res.status).toBe(401);
  });
});

// ── 3. admin list ───────────────────────────────────────────

describe('GET /api/admin/users — is_tester surfaced', () => {
  it('passes the flag through per row', async () => {
    h.listRows = [
      { id: 'u-1', email: 'tester@example.com', created_at: '2026-09-01', is_tester: true },
      { id: 'u-2', email: 'normal@example.com', created_at: '2026-09-02', is_tester: false },
    ];
    const json = await (await adminUsersGET(REQ)).json();
    expect(json.isTesterColumnAvailable).toBe(true);
    expect(json.users.map((u: any) => u.is_tester)).toEqual([true, false]);
  });

  it('degrades instead of 500-ing when the column is missing', async () => {
    h.testerColumnMissing = true;
    h.listRows = [{ id: 'u-1', email: 'tester@example.com', created_at: '2026-09-01' }];
    const res = await adminUsersGET(REQ);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.isTesterColumnAvailable).toBe(false);
    // unknown, NOT false — we must not claim a user isn't a tester
    expect(json.users[0].is_tester).toBeNull();
    // the retry must have dropped is_tester from the projection
    const userSelects = h.selectCols.filter((c) => c.startsWith('users:'));
    expect(userSelects.length).toBe(2);
    expect(userSelects[0]).toContain('is_tester');
    expect(userSelects[1]).not.toContain('is_tester');
  });
});

// ── 4. toggle action ────────────────────────────────────────

describe('PUT /api/admin/users { action: toggle_tester }', () => {
  it('grants the flag and audits it', async () => {
    h.toggleRow = { id: 'u-1', is_tester: false };
    const json = await (
      await adminUsersPUT(put({ userId: 'u-1', action: 'toggle_tester' }))
    ).json();

    expect(json.success).toBe(true);
    expect(json.is_tester).toBe(true);
    expect(h.updateCalls).toEqual([
      expect.objectContaining({ is_tester: true }),
    ]);
    expect(h.auditInserts[0]).toMatchObject({
      admin_email: 'admin@example.com',
      target_user_id: 'u-1',
      action: 'grant_tester',
      old_value: { is_tester: false },
      new_value: { is_tester: true },
    });
  });

  it('revokes the flag and audits it', async () => {
    h.toggleRow = { id: 'u-1', is_tester: true };
    const json = await (
      await adminUsersPUT(put({ userId: 'u-1', action: 'toggle_tester' }))
    ).json();

    expect(json.is_tester).toBe(false);
    expect(h.updateCalls[0]).toMatchObject({ is_tester: false });
    expect(h.auditInserts[0].action).toBe('revoke_tester');
  });

  it('409s with a migration hint when the column is missing — and writes nothing', async () => {
    h.toggleSelectError = { message: 'column users.is_tester does not exist' };
    const res = await adminUsersPUT(put({ userId: 'u-1', action: 'toggle_tester' }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/079/);
    expect(h.updateCalls).toHaveLength(0);
    expect(h.auditInserts).toHaveLength(0);
  });

  it('surfaces a failed write instead of reporting success', async () => {
    h.toggleRow = { id: 'u-1', is_tester: false };
    h.updateError = { message: 'permission denied for table users' };
    const res = await adminUsersPUT(put({ userId: 'u-1', action: 'toggle_tester' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/permission denied/);
    expect(json.success).toBeUndefined();
    expect(h.auditInserts).toHaveLength(0);
  });

  it('404s for an unknown user', async () => {
    h.toggleRow = null;
    const res = await adminUsersPUT(put({ userId: 'nope', action: 'toggle_tester' }));
    expect(res.status).toBe(404);
  });

  it('leaves the other admin actions untouched', async () => {
    const res = await adminUsersPUT(put({ userId: 'u-1', action: 'definitely_not_an_action' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('toggle_tester');
  });

  it('rejects a non-admin caller', async () => {
    h.adminError = NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const res = await adminUsersPUT(put({ userId: 'u-1', action: 'toggle_tester' }));
    expect(res.status).toBe(403);
    expect(h.updateCalls).toHaveLength(0);
  });
});
