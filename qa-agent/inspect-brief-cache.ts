import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const EM = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Inspect daily_briefs
  const { data: briefs, error: bErr } = await sb.from('daily_briefs').select('*').eq('user_id', EM).order('date', { ascending: false });
  console.log('=== daily_briefs for Em ===');
  if (bErr) { console.log('ERR', bErr.message); return; }
  console.log('count:', briefs?.length ?? 0);
  for (const b of (briefs || [])) {
    console.log(`  date=${b.date} account=${String(b.account_id || '').slice(0,8)} content_len=${(b.content || '').length} created=${b.created_at}`);
  }

  const { data: snaps, error: sErr } = await sb.from('weekly_snapshots').select('*').eq('user_id', EM).order('week_start', { ascending: false });
  console.log('\n=== weekly_snapshots for Em ===');
  if (sErr) { console.log('ERR', sErr.message); } else {
    console.log('count:', snaps?.length ?? 0);
    for (const s of (snaps || [])) {
      console.log(`  week_start=${s.week_start} account=${String(s.account_id || '').slice(0,8)} content_len=${(s.content || '').length} created=${s.created_at}`);
    }
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
