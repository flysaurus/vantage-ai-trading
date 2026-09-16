// ─── scripts/backfill-null-sectors.ts ───────────────────────
//
// ⚠️  WRITE-CAPABLE SCRIPT (flagged per workspace standing rule, added 2026-09-16)
//     In `--apply` mode this UPDATEs `positions.sector` and `positions.industry`
//     for the authenticated user's rows in live Supabase. Dry-run (the default)
//     performs ZERO writes: it only SELECTs and prints the plan.
//     Read-only unless `--apply` is passed explicitly.
//
// Purpose (parked item 8): fill `sector` for micro-positions that came back from
// SnapTrade with no sector/industry. Impact is small (≤0.5pt on Portfolio Health)
// but a null sector silently drops the position out of sector-exposure math.
//
// Target symbols flagged by the audit:
//   HII, KTOS, AXON, BWXT, RCAT, BRZE, MP, ALB, UUUU, ONTO, LAC
// (any other null-sector row of the user is also eligible — the symbol list is
// just the known backlog, not a filter, unless --only-listed is passed.)
//
// Env (never committed):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY (optional)
// Usage:
//   npx tsx scripts/backfill-null-sectors.ts                 # dry run
//   npx tsx scripts/backfill-null-sectors.ts --apply         # write
//   npx tsx scripts/backfill-null-sectors.ts --apply --only-listed
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { resolveSectorsForSymbols } from '../lib/sector-resolver';

const USER_ID =
  process.env.BACKFILL_USER_ID || '58ffa82a-2b14-4a5d-9662-5c48f105031f';

const BACKLOG = ['HII', 'KTOS', 'AXON', 'BWXT', 'RCAT', 'BRZE', 'MP', 'ALB', 'UUUU', 'ONTO', 'LAC'];

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply'); // ⚠️ flips this script to write mode
const ONLY_LISTED = argv.includes('--only-listed');

function isMissing(v: unknown): boolean {
  return v == null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'null';
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabase
    .from('positions')
    .select('id, symbol, sector, industry, connection_id')
    .eq('user_id', USER_ID);
  if (error) throw error;

  const rows = (data || []).filter((r: any) => isMissing(r.sector));
  const backlogSet = new Set(BACKLOG);
  const targets = ONLY_LISTED
    ? rows.filter((r: any) => backlogSet.has(String(r.symbol || '').toUpperCase()))
    : rows;

  console.log(`[backfill-null-sectors] user=${USER_ID}`);
  console.log(`[backfill-null-sectors] rows with null sector: ${rows.length}`);
  console.log(`[backfill-null-sectors] selected targets:      ${targets.length}${ONLY_LISTED ? ' (--only-listed)' : ''}`);
  console.log(`[backfill-null-sectors] mode: ${APPLY ? '⚠️  APPLY (writes)' : 'dry-run (no writes)'}`);

  if (targets.length === 0) return;

  const resolved = await resolveSectorsForSymbols(
    targets.map((r: any) => ({ symbol: r.symbol, industry: r.industry })),
  );

  let wouldWrite = 0;
  let unresolved: string[] = [];
  for (const r of targets) {
    const sym = String(r.symbol || '').toUpperCase();
    const sector = resolved.get(sym) ?? null;
    if (!sector) {
      unresolved.push(sym);
      continue;
    }
    wouldWrite += 1;
    console.log(`  ${sym}: ${r.sector ?? '(null)'} → ${sector}`);
    if (APPLY) {
      const patch: Record<string, unknown> = { sector };
      // Only backfill industry when the row is also missing it — never rewrite
      // an industry the broker already gave us.
      if (isMissing(r.industry)) patch.industry = null; // no industry source here
      const { error: upErr } = await supabase
        .from('positions')
        .update({ sector })
        .eq('id', r.id)
        .eq('user_id', USER_ID);
      if (upErr) console.error(`  ! ${sym} update failed: ${upErr.message}`);
    }
  }

  console.log(
    `[backfill-null-sectors] ${APPLY ? 'updated' : 'would update'}: ${wouldWrite}`, 
  );
  if (unresolved.length) {
    console.log(`[backfill-null-sectors] unresolved (needs manual/dataset): ${unresolved.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('backfill-null-sectors failed:', err);
  process.exit(1);
});
