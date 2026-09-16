// /tmp/xlf-probe.mjs — READ-ONLY: real XLF position so the evidence text can
// quote genuine numbers (no invented targets/quantities).

import { createClient } from '@supabase/supabase-js';

const USER_ID = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONNECTION_ID = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('positions')
  .select('symbol,qty,avg_cost,market_value,current_price,sector,unrealized_pnl')
  .eq('user_id', USER_ID)
  .eq('connection_id', CONNECTION_ID)
  .order('market_value', { ascending: false });

if (error) { console.error('ERR', error.message); process.exit(1); }
const total = data.reduce((s, p) => s + Number(p.market_value || 0), 0);
console.log('positions:', data.length, 'total market value:', total.toFixed(2));
for (const p of data.slice(0, 6)) {
  console.log(`${p.symbol.padEnd(6)} qty=${p.qty} px=${p.current_price} mv=${Number(p.market_value).toFixed(2)} share=${(100 * Number(p.market_value) / total).toFixed(2)}% sector=${p.sector}`);
}
const xlf = data.find((p) => String(p.symbol).toUpperCase() === 'XLF');
if (xlf) {
  const px = Number(xlf.current_price) || Number(xlf.market_value) / Number(xlf.qty);
  const half = Math.round(Number(xlf.qty) / 2 * 100) / 100;
  console.log('\nXLF real:', { qty: Number(xlf.qty), px: Number(px.toFixed(2)), mv: Number(xlf.market_value), sharePct: Number((100 * Number(xlf.market_value) / total).toFixed(2)) });
  console.log('HALVE the position => trim', half, 'shares = $' + (half * px).toFixed(2));
}
const sectors = {};
for (const p of data) sectors[p.sector || '(none)'] = (sectors[p.sector || '(none)'] || 0) + Number(p.market_value || 0);
console.log('\nsector weights:', Object.entries(sectors).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${(100 * v / total).toFixed(1)}%`).join('  '));
