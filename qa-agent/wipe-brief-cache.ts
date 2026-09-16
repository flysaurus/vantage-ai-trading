import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const EM = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const today = new Date().toISOString().split('T')[0]; // 2026-09-07

  // 1. Wipe today's daily_briefs for Em
  const { data: beforeBrief, error: e1 } = await sb.from('daily_briefs').select('account_id').eq('user_id', EM).eq('date', today);
  if (e1) { console.log('ERR select briefs', e1.message); return; }
  console.log('daily_briefs today BEFORE:', (beforeBrief || []).map(b => b.account_id));

  const { error: d1 } = await sb.from('daily_briefs').delete().eq('user_id', EM).eq('date', today);
  if (d1) { console.log('ERR delete briefs', d1.message); return; }
  const { data: afterBrief } = await sb.from('daily_briefs').select('account_id').eq('user_id', EM).eq('date', today);
  console.log('daily_briefs today AFTER :', afterBrief?.length ?? 0, 'rows');

  // 2. Wipe this week's weekly_snapshots for Em (Monday = today, since Sep 7 2026 is a Monday)
  const { data: beforeSnap, error: e2 } = await sb.from('weekly_snapshots').select('account_id').eq('user_id', EM).eq('week_start', today);
  if (e2) { console.log('ERR select snaps', e2.message); return; }
  console.log('weekly_snapshots this week BEFORE:', (beforeSnap || []).map(s => s.account_id));

  const { error: d2 } = await sb.from('weekly_snapshots').delete().eq('user_id', EM).eq('week_start', today);
  if (d2) { console.log('ERR delete snaps', d2.message); return; }
  const { data: afterSnap } = await sb.from('weekly_snapshots').select('account_id').eq('user_id', EM).eq('week_start', today);
  console.log('weekly_snapshots this week AFTER :', afterSnap?.length ?? 0, 'rows');

  console.log('\nWIPE COMPLETE — next Daily Brief / Weekly Snapshot load will regenerate fresh.');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
