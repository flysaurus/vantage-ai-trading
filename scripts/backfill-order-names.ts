/**
 * One-time backfill: persist full company/ETF names onto historical orders
 * (orders.company_name) so the client never needs a live name lookup again.
 *
 * Chain: Finnhub → Yahoo (via lib/market-data.ts resolveCompanyName), throttled
 * to stay under Finnhub's free-tier rate limit (~1.1s spacing).
 *
 * Usage:
 *   FINNHUB_IO_API_KEY=xxx SUPABASE_SERVICE_ROLE_KEY=yyy tsx scripts/backfill-order-names.ts
 *   (SUPABASE_URL defaults to the prod project URL.)
 */

import { createClient } from '@supabase/supabase-js';
import { resolveCompanyName } from '../lib/market-data';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ixjnuoslbzytubpplkot.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set. Export it before running.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: rows, error } = await supabase
    .from('orders')
    .select('symbol')
    .is('company_name', null);

  if (error) {
    console.error('❌ fetch failed:', error.message);
    process.exit(1);
  }

  // Keep the EXACT stored symbol (case) so the UPDATE matches precisely.
  const symbols = Array.from(new Set((rows || []).map((r) => r.symbol).filter(Boolean))) as string[];
  console.log(`Found ${symbols.length} distinct symbols to backfill:`, symbols.join(', '));

  let ok = 0;
  let unresolved = 0;
  for (let i = 0; i < symbols.length; i++) {
    const stored = symbols[i];
    const name = await resolveCompanyName(stored);
    if (name) {
      const { error: uErr } = await supabase
        .from('orders')
        .update({ company_name: name })
        .eq('symbol', stored)
        .is('company_name', null);
      if (uErr) {
        console.error(`❌ ${stored}: update failed: ${uErr.message}`);
        unresolved++;
      } else {
        console.log(`✅ ${stored} → ${name}`);
        ok++;
      }
    } else {
      console.warn(`⚠️ ${stored}: no name resolved (skipped)`);
      unresolved++;
    }
    // Finnhub free tier ≈ 60 req/min → ~1.1s spacing to be safe.
    await sleep(1100);
  }

  console.log(`\nDone. ${ok} symbols backfilled, ${unresolved} unresolved/skipped.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
