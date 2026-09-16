/**
 * Verification script for the Daily Brief / Weekly Snapshot $0.00 fix.
 * Run via: npx tsx qa-agent/verify-brief-fix.ts
 *
 * 1. Loads env (FINNHUB key from .env.local, service-role + SnapTrade from .env.reconcile.local)
 * 2. Runs getBatchQuotes() for KO/LLY/TSLA/TSM + indices -> REAL prices
 * 3. Queries positions table for Em's broker accounts
 * 4. Recomputes the Weekly Snapshot cost-basis/P&L math exactly as the route does
 * 5. Cross-checks persisted market_value vs avg_cost*qty vs quote*shares
 */
import { createClient } from '@supabase/supabase-js';
import { getBatchQuotes } from '../lib/market-data';
import fs from 'fs';

function loadEnvFiles() {
  const env: Record<string, string> = {};
  for (const f of ['.env.local', '.env.reconcile.local']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m) {
        const k = m[1];
        const v = m[2].trim().replace(/^["']|["']$/g, '');
        if (v && !(k in env)) env[k] = v;
      }
    }
  }
  return env;
}

const env = loadEnvFiles();
for (const k of ['FINNHUB_IO_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SNAPTRADE_CLIENT_ID', 'SNAPTRADE_CONSUMER_KEY', 'VAULT_ENCRYPTION_KEY']) {
  process.env[k] = env[k] || '';
}

const EM = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const ALPACA_CONN = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207'; // trading-enabled ~$101.9k
const FIDELITY_CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc'; // read-only ~$19,750

async function main() {
  console.log('FINNHUB key set:', !!process.env.FINNHUB_IO_API_KEY);
  console.log('SUPABASE url:', process.env.NEXT_PUBLIC_SUPABASE_URL);

  // 1. getBatchQuotes for the $0.00 tickers + indices
  console.log('\n=== getBatchQuotes([KO, LLY, TSLA, TSM, SPY, QQQ, IWM]) ===');
  const tickers = ['KO', 'LLY', 'TSLA', 'TSM', 'SPY', 'QQQ', 'IWM'];
  const quotes = await getBatchQuotes(tickers);
  for (const t of tickers) {
    const q = quotes.get(t);
    console.log(`${t}: price=${q?.price ?? 'NULL'} changePct=${q?.changePercent ?? 'NULL'}`);
  }

  // 2. Positions table
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: pos, error } = await sb.from('positions').select('*').eq('user_id', EM).in('connection_id', [ALPACA_CONN, FIDELITY_CONN]);

  console.log('\n=== Weekly Snapshot math recomputation (route parity) ===');
  if (error) { console.log('ERR', error.message); return; }

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const rows = (pos || []).map((p: any) => {
    const q = quotes.get((p.symbol || '').toUpperCase());
    const quotePrice = q?.price ?? 0;
    const avgCost = p.avgCost ?? p.avg_cost ?? 0;
    const shares = p.qty ?? 0;
    const persistedValue = p.market_value ?? p.marketValue;
    const currentPrice = quotePrice > 0 ? quotePrice : (persistedValue != null && persistedValue > 0 && shares > 0 ? persistedValue / shares : 0);
    const totalCost = avgCost ? shares * avgCost : 0;
    const marketValue = persistedValue != null && persistedValue > 0 ? persistedValue : (currentPrice ? shares * currentPrice : 0);
    const totalPnL = avgCost && currentPrice ? (currentPrice - avgCost) * shares : 0;
    const pnlPct = avgCost && currentPrice ? ((currentPrice - avgCost) / avgCost) * 100 : null;
    // persisted market_value implies P&L = market_value - cost basis
    const persistedImpliedPnL = avgCost && persistedValue != null && persistedValue > 0 ? persistedValue - totalCost : null;
    return { p, quotePrice, avgCost, shares, currentPrice, totalCost, marketValue, totalPnL, pnlPct, persistedImpliedPnL };
  });

  for (const r of rows) {
    const p = r.p;
    const pnlStr = r.pnlPct != null ? `${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(1)}%` : 'N/A';
    const totalPnLStr = r.totalPnL !== 0 ? `${r.totalPnL >= 0 ? '+' : ''}${fmt(Math.abs(r.totalPnL))}` : 'N/A';
    const impliedStr = r.persistedImpliedPnL != null ? `${r.persistedImpliedPnL >= 0 ? '+' : ''}${fmt(Math.abs(r.persistedImpliedPnL))}` : 'N/A';
    const conn = p.connection_id === ALPACA_CONN ? 'ALPACA' : 'FIDELITY';
    console.log(`[${conn}] ${p.symbol}: ${r.shares}sh avg=${fmt(r.avgCost)} cur=${fmt(r.currentPrice)} | costBasis=${fmt(r.totalCost)} mktVal=${fmt(r.marketValue)} | PnL=${pnlStr} (${totalPnLStr}) | mktVal-implied=${impliedStr}`);
  }

  // 3. Summary: totals for Alpaca
  const alpaca = rows.filter(r => r.p.connection_id === ALPACA_CONN);
  const fid = rows.filter(r => r.p.connection_id === FIDELITY_CONN);
  const sum = (arr: typeof rows, k: 'totalCost' | 'marketValue' | 'totalPnL') => arr.reduce((s, r) => s + r[k], 0);
  console.log('\n=== TOTALS ===');
  console.log(`ALPACA: costBasis=${fmt(sum(alpaca, 'totalCost'))} mktVal=${fmt(sum(alpaca, 'marketValue'))} PnL=${fmt(sum(alpaca, 'totalPnL'))}`);
  console.log(`FIDELITY: costBasis=${fmt(sum(fid, 'totalCost'))} mktVal=${fmt(sum(fid, 'marketValue'))} PnL=${fmt(sum(fid, 'totalPnL'))}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
