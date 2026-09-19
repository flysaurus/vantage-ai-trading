// ─── scripts/drift-shadow-pass.ts ───────────────────────────────────────────
//
// ⚠️ READ-ONLY (by construction): every supabase mutation throws via proxy.
//
// (4c) DECISION EVIDENCE HARNESS — Em wants DATA before ruling on the style-aware
// bucket policy, specifically: "how often does a fully-unheld bucket (e.g. 0%
// International vs a 15% target) show up as material, and does that look like
// real drift or noise — matching how equity-sector 0%-holding drift already
// works, or firing on buckets the account was never going to hold?"
//
// So each pass, for EVERY styled user × broker account, records per target bucket:
//   currentPct (EXACT — computed from the same decomposition helpers the engine
//   uses, not the rounded shadow log), targetPct, deviation, unheld (held == 0),
//   fires (|dev| >= 15pp = "material"), shadowed, surfaced.
//
// Rows append to `state/drift-shadow.jsonl` (one JSON object per bucket per run),
// so multiple cycles accumulate and the report is measurement, not opinion.
//
// Usage: cd /root/projects/vantage && npx tsx scripts/drift-shadow-pass.ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config: loadEnv } = require('dotenv') as { config: (o: { path: string }) => void };
loadEnv({ path: '.env.reconcile.local' });
loadEnv({ path: '.env.local' });
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveBrokerNoticedInput } from '../lib/noticed/resolve-input';
import { findDriftTriggers } from '../lib/noticed/engine';
import { STYLE_SECTOR_TARGETS, NON_SECTOR_BUCKETS } from '../lib/sector-targets';
import { resolveEtfWeightsForPositions, decomposePositionValue } from '../lib/etf-sectors';

const LEDGER = 'state/drift-shadow.jsonl';
const SHADOW_STYLES = new Set(['soros']);
const DRIFT_THRESHOLD_PP = 15;

function readOnlyProxy(sb: any) {
  const BLOCKED = ['insert', 'update', 'upsert', 'delete', 'rpc'];
  return new Proxy(sb, {
    get(target, prop, recv) {
      if (typeof prop === 'string' && BLOCKED.includes(prop)) {
        return () => { throw new Error(`read-only probe attempted supabase.${prop}()`); };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

interface Row {
  runTs: string; user: string; style: string; scope: string; bucket: string;
  currentPct: number; targetPct: number; deviation: number; heldValue: number;
  unheld: boolean; fires: boolean; shadowed: boolean; surfaced: boolean;
  /** held < 1% of the denominator — "effectively unheld" (a bucket the account's
   *  strategy was never going to hold, as opposed to a real weight mismatch) */
  unheldLe1: boolean;
  /** 'native' = the account's own style; 'cross' = the same real portfolio scored
   *  against another archetype's targets (the equity-vs-macro comparison). */
  mode: 'native' | 'cross';
  /** the account holder's real style (differs from `style` on cross rows) */
  acctStyle: string;
}

interface Resolved {
  user: string; scope: string; acctStyle: string;
  bucketVals: Map<string, number>; total: number; positions: number;
}

async function main() {
  const sb = readOnlyProxy(
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  ) as any;

  const { data: users } = await sb.from('users').select('id, investor_style');
  const styleOf = new Map<string, string | null>((users || []).map((u: any) => [u.id, u.investor_style || null]));
  const styled = (users || []).filter((u: any) => u.investor_style);
  console.log(`styled users: ${styled.map((u: any) => `${u.id.slice(0, 8)}:${u.investor_style}`).join(' ')}`);

  const { data: conns } = await sb.from('broker_connections').select('*').in('user_id', styled.map((u: any) => u.id));
  const connsByUser = new Map<string, number>();
  for (const c of conns || []) connsByUser.set(c.user_id, (connsByUser.get(c.user_id) || 0) + 1);
  for (const u of styled) {
    console.log(`  user ${u.id.slice(0, 8)} style=${(u.investor_style || '').padEnd(9)} connections=${connsByUser.get(u.id) || 0}`);
  }
  const runTs = new Date().toISOString();
  const rows: Row[] = [];
  const leaks: string[] = [];
  const resolvedAccts: Resolved[] = [];

  for (const conn of conns || []) {
    const style = styleOf.get(conn.user_id) || '';
    const targets = STYLE_SECTOR_TARGETS[style];
    if (!targets) continue;
    const styleTargets = new Set(Object.keys(targets));
    const accts = Array.isArray(conn.snaptrade_accounts) ? conn.snaptrade_accounts : [];
    const scopes = accts.length
      ? accts.map((a: any) => `snaptrade:${conn.id}:${a.id || a.account_id || a.snaptrade_account_id}`)
      : [`snaptrade:${conn.id}`];

    for (const scope of scopes) {
      let input: any = null;
      try { input = await resolveBrokerNoticedInput(sb, conn.user_id, scope, []); } catch { continue; }
      if (!input) continue;
      if (input.account.cash == null) {
        console.log(`  skip ${scope} — cash unknown (drift skips by design, not estimated)`);
        continue;
      }
      let etfWeights = new Map<string, Record<string, number>>();
      try { etfWeights = await resolveEtfWeightsForPositions(input.positions, sb); } catch { /* static fallback */ }

      const invested = input.positions.reduce((s: number, p: any) => s + (p.marketValue || 0), 0);
      const total = invested + input.account.cash;

      // EXACT bucket holdings via the engine's own helpers.
      const bucketVals = new Map<string, number>();
      for (const pos of input.positions) {
        const resolved = etfWeights.get((pos.symbol || '').toUpperCase());
        for (const [b, v] of Object.entries(decomposePositionValue(pos.symbol, pos.sector, pos.marketValue, resolved))) {
          bucketVals.set(b, (bucketVals.get(b) || 0) + (v as number));
        }
      }

      // Capture the engine's shadow lines while running the real rule.
      const captured: string[] = [];
      const origLog = console.log;
      console.log = (...a: any[]) => { captured.push(a.join(' ')); };
      let drift: any[] = [];
      try { drift = findDriftTriggers(input, new Set<string>(), style, etfWeights); } catch { /* ignore */ }
      console.log = origLog;

      const firedKeys = new Set(drift.map((t) => String(t.trigger_key)));
      const nonSectorLeak = drift.filter((t) => NON_SECTOR_BUCKETS.has(String(t.meta?.sector)));
      if (SHADOW_STYLES.has(style) && nonSectorLeak.length) leaks.push(`${scope}: ${nonSectorLeak.map((t) => t.trigger_key).join(',')}`);

      console.log(`\n───── ${style} ${scope.slice(0, 60)} | positions=${input.positions.length} cash=${input.account.cash}`);
      for (const [bucket, targetPct] of Object.entries(targets)) {
        if (bucket === 'Cash') continue;
        if (NON_SECTOR_BUCKETS.has(bucket) && !styleTargets.has(bucket)) continue; // not comparable for this style
        const heldValue = bucketVals.get(bucket) || 0;
        const currentPct = total > 0 ? (heldValue / total) * 100 : 0;
        const deviation = Math.round((currentPct - targetPct) * 10) / 10;
        const fires = Math.abs(deviation) >= DRIFT_THRESHOLD_PP;
        const shadowed = SHADOW_STYLES.has(style) && NON_SECTOR_BUCKETS.has(bucket);
        const key = `DRIFT_${bucket.replace(/[^a-zA-Z0-9]/g, '_')}`;
        rows.push({
          runTs, user: conn.user_id, style, scope, bucket,
          currentPct: +currentPct.toFixed(2), targetPct, deviation,
          heldValue: +heldValue.toFixed(2), unheld: heldValue === 0, unheldLe1: currentPct <= 1,
          fires, shadowed, surfaced: firedKeys.has(key),
          mode: 'native', acctStyle: style,
        });
        if (fires) {
          console.log(
            `   ${fires ? '▲ MATERIAL' : '  ok'} ${bucket.padEnd(20)} ${currentPct.toFixed(2)}% vs ${targetPct}% (${deviation > 0 ? '+' : ''}${deviation}pp)` +
            `${heldValue === 0 ? '  ⬅ FULLY UNHELD' : ''}${shadowed ? '  [shadow]' : ''}`,
          );
        }
      }
      resolvedAccts.push({ user: conn.user_id, scope, acctStyle: style, bucketVals, total, positions: input.positions.length });
    }
  }

  // ── CROSS-STYLE: score the SAME real portfolios against every other archetype.
  // This is Em's comparison: does a fully-unheld bucket firing look like genuine
  // drift (equity-sector style already behaves that way) or like macro noise?
  console.log('\n=== CROSS-STYLE (same real accounts, each archetype\'s targets) ===');
  const crossByStyle = new Map<string, { fires: number; unheldFires: number; reads: number }>();
  for (const acct of resolvedAccts) {
    for (const [style2, targets2] of Object.entries(STYLE_SECTOR_TARGETS)) {
      if (style2 === acct.acctStyle) continue;
      const styleTargets2 = new Set(Object.keys(targets2));
      for (const [bucket, targetPct] of Object.entries(targets2)) {
        if (bucket === 'Cash') continue;
        if (NON_SECTOR_BUCKETS.has(bucket) && !styleTargets2.has(bucket)) continue;
        const heldValue = acct.bucketVals.get(bucket) || 0;
        const currentPct = acct.total > 0 ? (heldValue / acct.total) * 100 : 0;
        const deviation = Math.round((currentPct - targetPct) * 10) / 10;
        const fires = Math.abs(deviation) >= DRIFT_THRESHOLD_PP;
        const s = crossByStyle.get(style2) || { fires: 0, unheldFires: 0, reads: 0 };
        s.reads++; if (fires) { s.fires++; if (heldValue === 0) s.unheldFires++; }
        crossByStyle.set(style2, s);
        rows.push({
          runTs, user: acct.user, style: style2, scope: acct.scope, bucket,
          currentPct: +currentPct.toFixed(2), targetPct, deviation,
          heldValue: +heldValue.toFixed(2), unheld: heldValue === 0, unheldLe1: currentPct <= 1,
          fires, shadowed: SHADOW_STYLES.has(acct.acctStyle) && NON_SECTOR_BUCKETS.has(bucket), surfaced: false,
          mode: 'cross', acctStyle: acct.acctStyle,
        });
      }
    }
  }
  for (const [s2, v] of crossByStyle) {
    console.log(`  as-${s2.padEnd(10)} material=${v.fires}/${v.reads} reads | fully-unheld=${v.unheldFires}${v.fires ? ` (${Math.round((v.unheldFires / v.fires) * 100)}% of fires)` : ''}`);
  }

  fs.mkdirSync('state', { recursive: true });
  fs.appendFileSync(LEDGER, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // ── summary for this cycle + cumulative ──
  const byStyle = new Map<string, { buckets: number; fires: number; unheldFires: number }>();
  for (const r of rows.filter((x) => x.mode === 'native')) {
    const s = byStyle.get(r.style) || { buckets: 0, fires: 0, unheldFires: 0 };
    s.buckets++; if (r.fires) { s.fires++; if (r.unheldLe1) s.unheldFires++; }
    byStyle.set(r.style, s);
  }
  console.log('\n=== CYCLE SUMMARY (native styles only) ===');
  for (const [s, v] of byStyle) {
    console.log(`  ${s.padEnd(10)} buckets=${v.buckets} material=${v.fires} of-which-≤1%-held=${v.unheldFires}${v.fires ? ` (${Math.round((v.unheldFires / v.fires) * 100)}%)` : ''}`);
  }
  console.log(leaks.length ? `  ⚠️ NON-SECTOR LEAK: ${leaks.join(' | ')}` : '  ✅ no non-sector leak (shadow holds)');

  // cumulative across all cycles in the ledger
  if (fs.existsSync(LEDGER)) {
    const allRaw = fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
    const all = allRaw.filter((r) => (r.mode || 'native') === 'native');
    const runs = new Set(allRaw.map((r) => r.runTs)).size;
    console.log(`=== CUMULATIVE (${runs} cycle(s) in ${LEDGER}) ===`);
    const perStyle = new Map<string, Row[]>();
    for (const r of all) { if (!perStyle.has(r.style)) perStyle.set(r.style, []); perStyle.get(r.style)!.push(r); }
    for (const [s, rs] of perStyle) {
      const fires = rs.filter((r) => r.fires);
      const unheld = fires.filter((r) => r.unheldLe1 !== undefined ? r.unheldLe1 : r.unheld);
      console.log(`  ${s.padEnd(10)} fires=${fires.length}/${rs.length} bucket-reads | ≤1%-held=${unheld.length}${fires.length ? ` (${Math.round((unheld.length / fires.length) * 100)}%)` : ''}`);
    }
    // examples
    const ex = all.filter((r) => r.fires).slice(-8);
    console.log('  last material reads:');
    for (const r of ex) {
      console.log(`    [${r.runTs.slice(0, 16)}] ${r.style}/${r.bucket} ${r.currentPct}% vs ${r.targetPct}% (${r.deviation > 0 ? '+' : ''}${r.deviation}pp)${r.unheld ? ' UNHELD' : ''}${r.shadowed ? ' shadow' : ''}${r.surfaced ? ' SURFACED' : ''}`);
    }
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
