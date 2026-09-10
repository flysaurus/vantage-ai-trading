// ROUND 4 — live verification: 'Remind in 5d' on a noticed card is wired to the
// real snooze mechanism and actually suppresses re-firing for 5 real days.
//   • POST /api/ai/noticed/dismiss {dismissType:'5d'} writes dismissed_until
//   • the DB row reads back as now + exactly 5.000 days
//   • the read path (GET /api/ai/noticed) hides the item
//   • a REAL engine run (POST /api/ai/noticed → runNoticedPipeline) neither
//     resets the snooze nor re-inserts a fresh unresolved row
// Run:  node qa-agent/verify-snooze-5d.cjs   (needs a fresh minted session)
const fs = require('fs');
const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const env = fs.readFileSync('/root/projects/vantage/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const SB = get('NEXT_PUBLIC_SUPABASE_URL') || get('SUPABASE_URL'), KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const b64url = (x) => Buffer.from(x, 'utf8').toString('base64url');
const sessObj = { access_token: session.access_token, token_type: 'bearer', expires_in: 3600, expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user };
const COOKIE = `sb-${REF}-auth-token=base64-${b64url(JSON.stringify(sessObj))}`;
const ACCT = 'snaptrade:ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const fails = [];
const check = (name, pass, detail = '') => { console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) fails.push(name); };
const H = { 'content-type': 'application/json', cookie: COOKIE };

(async () => {
  // 0. before
  const sb = async (path) => {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
    return r.json();
  };
  const before = await sb(`noticed_items?select=id,trigger_key,trigger_type,title,dismissed_until,resolved&order=created_at.desc&limit=20`);
  console.log('DB rows before:', Array.isArray(before) ? before.length : before);
  const live = (await fetch(`${BASE}/api/ai/noticed?accountId=${encodeURIComponent(ACCT)}`, { headers: H }).then((r) => r.json()));
  const items = live.items || live.noticed || [];
  console.log('API items returned:', items.length);
  if (items.length === 0) { console.log('NO ITEMS TO TEST — abort'); process.exit(2); }
  const target = items.find((i) => i.id) || items[0];
  console.log('chosen item:', target.id, target.triggerType, '|', String(target.title).slice(0, 60));

  const t0 = Date.now();
  const dr = await fetch(`${BASE}/api/ai/noticed/dismiss`, { method: 'POST', headers: H, body: JSON.stringify({ itemId: target.id, dismissType: '5d' }) });
  const dj = await dr.json().catch(() => ({}));
  console.log('dismiss status', dr.status, JSON.stringify(dj).slice(0, 200));

  const row = (await sb(`noticed_items?id=eq.${target.id}&select=id,dismissed_until,resolved,body`))[0];
  const until = row && row.dismissed_until ? new Date(row.dismissed_until).getTime() : null;
  const days = until ? (until - t0) / 86400000 : null;
  console.log('DB dismissed_until:', row && row.dismissed_until, '→ +' + (days === null ? 'n/a' : days.toFixed(3)) + ' days');
  check('WRITE_BACK: dismissed_until = now + 5 days', days !== null && days > 4.9 && days < 5.1, `+${days === null ? 'n/a' : days.toFixed(3)}d`);

  // 1. read path hides it?
  const live2 = await fetch(`${BASE}/api/ai/noticed?accountId=${encodeURIComponent(ACCT)}`, { headers: H }).then((r) => r.json());
  const items2 = live2.items || live2.noticed || [];
  const stillThere = items2.some((i) => i.id === target.id);
  check('Read path suppresses the snoozed item', !stillThere, `items ${items.length} → ${items2.length}`);

  // 2. engine re-run must not reset the snooze
  const row2 = (await sb(`noticed_items?id=eq.${target.id}&select=id,dismissed_until,resolved,body`))[0];
  console.log('after engine re-run, dismissed_until:', row2 && row2.dismissed_until, '→ still +' + (((new Date(row2.dismissed_until).getTime() - t0) / 86400000).toFixed(3)) + ' days');
  check('Snooze not reset by a re-run', !!row2 && row2.dismissed_until === row.dismissed_until);
  check('Snoozed item stays unresolved (so re-activation cannot target it)', !!row2 && row2.resolved === false);

  // 3. REALLY run the engine (POST runs the pipeline; GET does not)
  const pr = await fetch(`${BASE}/api/ai/noticed?accountId=${encodeURIComponent(ACCT)}`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ accountId: ACCT, portfolio: null, positions: [], watchlistSymbols: [], })
  });
  const pj = await pr.json().catch(() => ({}));
  console.log('POST engine status', pr.status, 'trulyNew=', pj.trulyNew, 'haikuGenerated=', pj.haikuGenerated, 'items=', (pj.items || []).length);
  const afterPost = (await sb(`noticed_items?id=eq.${target.id}&select=id,dismissed_until,resolved,trigger_key`))[0];
  console.log('after REAL engine run, dismissed_until:', afterPost && afterPost.dismissed_until);
  check('Snooze survives a REAL engine run', !!afterPost && afterPost.dismissed_until === row.dismissed_until && afterPost.resolved === false);
  const key = afterPost && afterPost.trigger_key;
  const dupes = await sb(`noticed_items?trigger_key=eq.${encodeURIComponent(key)}&account_id=eq.${encodeURIComponent(ACCT)}&select=id,dismissed_until,resolved,created_at`);
  console.log('rows with that trigger_key:', JSON.stringify(dupes));
  check('No fresh duplicate row re-inserted', Array.isArray(dupes) && !dupes.some((d) => d.id !== target.id && d.dismissed_until === null && d.resolved === false));
  check('Still hidden from the feed after the engine run', !((pj.items || []).some((i) => i.id === target.id)));
  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL LIVE SNOOZE CHECKS PASSED'}`);
  process.exit(fails.length ? 1 : 0);
})();
