// ─── scripts/_probe-noticed-sma2.ts ─────────────────────────────────────────
//
// ⚠️ READ-ONLY. Part 2 of the SMA "Rufus Noticed" audit:
//   1. exact noticed_items rows per scope (no bogus columns this time)
//   2. the noticed AI budget gate (the insert is gated on checkUsageLimit!)
//   3. event_impact + bounce_back evaluated live for the SMA scope
//
// Usage: source .env.local && npx tsx scripts/_probe-noticed-sma2.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { resolveBrokerNoticedInput } from '../lib/noticed/resolve-input';
import { findEventImpactTriggers } from '../lib/noticed/event-impact';
import { findBounceBackTriggers } from '../lib/noticed/bounce-back';
import { checkUsageLimit } from '../lib/ai-guard';

const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const SMA = '47b6f4e3-419e-43fc-ae3d-b67ea579f57d';
const ANIKET = 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe';

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── 1. every noticed_items row for the three scopes ──
  for (const scope of [`snaptrade:${CONN}`, `snaptrade:${CONN}:${SMA}`, `snaptrade:${CONN}:${ANIKET}`, 'demo']) {
    const { data, error } = await sb
      .from('noticed_items')
      .select('trigger_type,trigger_key,resolved,created_at,title,account_id')
      .eq('account_id', scope)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) { console.log(`@${scope} ERROR:`, error.message); continue; }
    console.log(`\n=== noticed_items @ ${scope}: ${(data || []).length} rows`);
    for (const r of data || []) {
      console.log(`  ${r.created_at}  ${r.resolved ? 'resolved' : 'ACTIVE  '}  ${r.trigger_type.padEnd(20)} ${r.trigger_key}`);
    }
  }

  // ── 2. the AI budget gate that guards the INSERT ──
  const budget = await checkUsageLimit(USER, 'noticed');
  console.log('\n=== checkUsageLimit(user,"noticed"):', JSON.stringify(budget));

  // also the other surface budgets for context
  for (const t of ['dailyBrief', 'weeklySnapshot', 'greeting'] as const) {
    try {
      const b = await checkUsageLimit(USER, t);
      console.log(`  ${t}:`, JSON.stringify(b));
    } catch (e: any) { console.log(`  ${t}: ERROR ${e?.message}`); }
  }

  // ── 3. event_impact + bounce_back, live for SMA ──
  const input = await resolveBrokerNoticedInput(sb as any, USER, `snaptrade:${CONN}:${SMA}`, []);
  if (input) {
    const none = new Set<string>();
    try {
      const ev = await findEventImpactTriggers(input, none);
      console.log('\n=== findEventImpactTriggers (SMA) →', JSON.stringify(
        ev.map((t) => ({ type: t.trigger_type, key: t.trigger_key, title: t.title, severity: t.meta?.severity, symbol: t.meta?.symbol })), null, 1));
      const reviewSyms = new Set(ev.filter((t) => t.meta?.severity === 'review').map((t) => String(t.meta?.symbol).toUpperCase()));
      const bb = await findBounceBackTriggers(input, none, reviewSyms);
      console.log('=== findBounceBackTriggers (SMA) →', JSON.stringify(
        bb.map((t) => ({ type: t.trigger_type, key: t.trigger_key, title: t.title })), null, 1));
    } catch (e: any) {
      console.log('event/bounce error:', e?.message);
    }
    // positions carrying real (non-zero) day change? bounce-back needs a move
    const bigMovers = (input.positions || []).filter((p) => Math.abs(p.totalPnlPercent || 0) > 20).length;
    console.log('positions with |totalPnl%|>20:', bigMovers, '| watchlist:', input.watchlistSymbols.length);
  } else {
    console.log('\nresolveBrokerNoticedInput → null');
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
