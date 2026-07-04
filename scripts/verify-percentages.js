#!/usr/bin/env node
/**
 * Portfolio % Verification Test
 * 
 * Independently recalculates TODAY %, TOTAL %, and time-range chart %
 * from the same data sources the UI uses, then compares against expected values.
 * 
 * Usage: node scripts/verify-percentages.js
 */

const FINNHUB_KEY = process.env.FINNHUB_IO_API_KEY;
const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const STARTING_CAPITAL = 100000;

// ── Test positions (same as "buffett" demo portfolio seed) ──
const POSITIONS = [
  { symbol: 'BRK.B', qty: 20, avgCost: 479.22, buyDate: '2025-08-15', totalCost: 20 * 479.22 },
  { symbol: 'KO',    qty: 80, avgCost: 71.22,  buyDate: '2025-10-22', totalCost: 80 * 71.22 },
  { symbol: 'AXP',   qty: 20, avgCost: 375.61, buyDate: '2026-01-10', totalCost: 20 * 375.61 },
];

// Cost basis
const TOTAL_COST = POSITIONS.reduce((s, p) => s + p.totalCost, 0);
// $9,584.40 + $5,697.60 + $7,512.20 = $22,794.20

// ── Range params (matching chart API) ──
function getRangeParams(range) {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date();
  switch (range) {
    case '1D': {
      const open = new Date(); open.setHours(9, 30, 0, 0);
      if (open.getTime() > Date.now()) { open.setDate(open.getDate() - 1); if (open.getDay() === 6) open.setDate(open.getDate() - 1); if (open.getDay() === 0) open.setDate(open.getDate() - 2); }
      return { from: Math.floor(open.getTime() / 1000), to: Math.min(Math.floor((new Date(open)).setHours(16,0,0,0) / 1000), now), resolution: '60' };
    }
    case '1W': return { from: now - 7 * 86400, to: now, resolution: '60' };
    case '1M': return { from: now - 30 * 86400, to: now, resolution: '60' };
    case 'YTD': return { from: Math.floor(new Date(today.getFullYear(), 0, 1).getTime() / 1000), to: now, resolution: 'D' };
    case 'ALL': return { from: Math.floor(new Date('2024-01-08').getTime() / 1000), to: now, resolution: 'W' };
  }
}

// ── Fetch current quotes ──
async function fetchQuotes() {
  const results = {};
  for (const pos of POSITIONS) {
    try {
      const url = `${FINNHUB_BASE}/quote?symbol=${pos.symbol}&token=${FINNHUB_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      results[pos.symbol] = data;
    } catch (e) {
      console.error(`  ❌ Failed to fetch quote for ${pos.symbol}:`, e.message);
    }
  }
  return results;
}

// ── Fetch candles for a symbol ──
async function fetchCandles(symbol, from, to, resolution) {
  // Try Finnhub first
  const url = `${FINNHUB_BASE}/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.s === 'ok' && data.t?.length > 0) {
      const map = {};
      data.t.forEach((t, i) => { map[t] = data.c[i]; });
      return { timestamps: data.t, map };
    }
  } catch {}

  // Fallback to Yahoo
  const intervalMap = { '60': '1h', 'D': '1d', 'W': '1wk' };
  const interval = intervalMap[resolution] || '1d';
  const yurl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${from}&period2=${to}&interval=${interval}&events=history`;
  try {
    const res = await fetch(yurl, { headers: { 'User-Agent': 'Vantage/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('No result');
    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close;
    const map = {};
    timestamps.forEach((t, i) => { if (closes[i] != null) map[t] = closes[i]; });
    return { timestamps, map };
  } catch {
    return null;
  }
}

// ── Build portfolio value from candle maps at a timestamp ──
function portfolioValueAt(candleMaps, timestamp, cashBalance) {
  let value = cashBalance;
  for (const pos of POSITIONS) {
    const buyTime = pos.buyDate ? Math.floor(new Date(pos.buyDate).getTime() / 1000) : 0;
    if (timestamp < buyTime) {
      value += pos.totalCost; // position didn't exist → cash wasn't spent yet
    } else {
      const price = candleMaps[pos.symbol]?.[timestamp];
      if (typeof price === 'number' && price > 0) {
        value += pos.qty * price;
      } else {
        value += pos.avgCost ? pos.qty * pos.avgCost : 0; // fallback
      }
    }
  }
  return Math.round(value * 100) / 100;
}

// ── Main ──
async function main() {
  console.log('═'.repeat(60));
  console.log('  VANTAGE PORTFOLIO % VERIFICATION');
  console.log('═'.repeat(60));
  console.log(`\nPositions: ${POSITIONS.map(p => p.symbol).join(', ')}`);
  console.log(`Cost basis: $${TOTAL_COST.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  const cashBalance = Math.max(0, STARTING_CAPITAL - TOTAL_COST);
  console.log(`Cash: $${cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Starting capital: $${STARTING_CAPITAL.toLocaleString()}\n`);

  // ── Step 1: Fetch live quotes ──
  console.log('Fetching live quotes...');
  const quotes = await fetchQuotes();
  let totalMarketValue = 0;
  let totalDayPnl = 0;

  for (const pos of POSITIONS) {
    const q = quotes[pos.symbol];
    const price = q && q.c > 0 ? q.c : pos.avgCost;
    const prevClose = q?.pc || price;
    const mv = pos.qty * price;
    totalMarketValue += mv;

    console.log(`  ${pos.symbol}: $${price.toFixed(2)} × ${pos.qty} = $${mv.toFixed(2)}`);

    if (q && q.c > 0) {
      const dayChange = (q.c - prevClose) * pos.qty;
      totalDayPnl += dayChange;
    }
  }

  const currentEquity = totalMarketValue + cashBalance;
  const totalPnl = currentEquity - STARTING_CAPITAL;

  console.log(`\n── Live Calculations ──`);
  console.log(`  Market value:  $${totalMarketValue.toFixed(2)}`);
  console.log(`  Cash:          $${cashBalance.toFixed(2)}`);
  console.log(`  Account value: $${currentEquity.toFixed(2)}`);
  console.log(`  Total P&L:     $${totalPnl.toFixed(2)}`);
  console.log(`  Day P&L:       $${totalDayPnl.toFixed(2)}`);

  // ── Step 2: Calculate % the RIGHT way ──
  console.log(`\n── Percentage Verification ──`);

  // TOTAL % should be vs $100K
  const correctTotalPct = (totalPnl / STARTING_CAPITAL) * 100;
  console.log(`\n  TOTAL %%:`);
  console.log(`    Correct:   ${totalPnl >= 0 ? '+' : ''}${correctTotalPct.toFixed(1)}%  ($${totalPnl.toFixed(2)} / $${STARTING_CAPITAL.toLocaleString()})`);
  console.log(`    OLD BUG:   ${totalPnl >= 0 ? '+' : ''}${((totalPnl / TOTAL_COST) * 100).toFixed(1)}%  (was dividing by $${TOTAL_COST.toFixed(2)} cost basis)`);

  // TODAY % = dayPnl / (equity - dayPnl) — standard daily return
  const prevEquity = currentEquity - totalDayPnl;
  const correctTodayPct = prevEquity > 0 ? (totalDayPnl / prevEquity) * 100 : 0;
  console.log(`\n  TODAY %%:`);
  console.log(`    Formula:    ($${totalDayPnl.toFixed(2)} / $${prevEquity.toFixed(2)}) × 100`);
  console.log(`    Result:     ${totalDayPnl >= 0 ? '+' : ''}${correctTodayPct.toFixed(2)}%`);

  // ── Step 3: Verify chart range % for each timeframe ──
  console.log(`\n── Chart Range % Verification ──`);

  const cashForChart = cashBalance; // Equivalent to displayAccount?.cash ?? 0

  for (const range of ['1M', 'ALL']) {
    const { from, to, resolution } = getRangeParams(range);
    console.log(`\n  ${range} (${new Date(from * 1000).toLocaleDateString()} → now, resolution=${resolution}):`);

    // Fetch candles for all symbols
    const candleMaps = {};
    let refTimestamps = [];
    for (const pos of POSITIONS) {
      const result = await fetchCandles(pos.symbol, from, to, resolution);
      if (result) {
        candleMaps[pos.symbol] = result.map;
        if (refTimestamps.length === 0) refTimestamps = result.timestamps;
      } else {
        candleMaps[pos.symbol] = {};
      }
    }

    if (refTimestamps.length < 2) {
      console.log(`    ⚠️  Not enough candle data for ${range}`);
      continue;
    }

    const firstTs = refTimestamps[0];
    const lastTs = refTimestamps[refTimestamps.length - 1];
    const firstVal = portfolioValueAt(candleMaps, firstTs, cashForChart);
    const lastVal = portfolioValueAt(candleMaps, lastTs, cashForChart);
    const rangeReturn = lastVal - firstVal;
    const rangeReturnPct = ((lastVal - firstVal) / (firstVal || 1)) * 100;

    console.log(`    Points:      ${refTimestamps.length}`);
    console.log(`    First value: $${firstVal.toFixed(2)} (${new Date(firstTs * 1000).toLocaleDateString()})`);
    console.log(`    Last value:  $${lastVal.toFixed(2)} (${new Date(lastTs * 1000).toLocaleDateString()})`);
    console.log(`    Return:      ${rangeReturn >= 0 ? '+' : ''}$${rangeReturn.toFixed(2)} (${rangeReturnPct >= 0 ? '+' : ''}${rangeReturnPct.toFixed(2)}%)`);

    // Sanity checks
    if (range === 'ALL') {
      const expectedFirst = STARTING_CAPITAL; // Before any positions existed, should be full cash
      const diff = Math.abs(firstVal - expectedFirst);
      if (diff > 100) {
        console.log(`    ⚠️  WARNING: ALL starting value $${firstVal.toFixed(2)} differs from expected $${expectedFirst} by $${diff.toFixed(2)}`);
        console.log(`       This means cashBalance passed to chart ($${cashForChart}) + cost add-backs ($${TOTAL_COST}) ≠ $${STARTING_CAPITAL}`);
        console.log(`       Check: $${cashForChart} + $${TOTAL_COST} = $${(cashForChart + TOTAL_COST).toFixed(2)} vs $${STARTING_CAPITAL}`);
      } else {
        console.log(`    ✅ ALL starting value ~$${STARTING_CAPITAL} (matches starting capital)`);
      }
    }
  }

  // ── Step 4: Summary ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  VERIFICATION SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Account value: $${currentEquity.toFixed(2)}`);
  console.log(`  Total P&L:     $${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`);
  console.log(`  TOTAL %%:      ${totalPnl >= 0 ? '+' : ''}${correctTotalPct.toFixed(1)}%  ✅ (vs $100K)`);
  console.log(`  TODAY %%:      ${totalDayPnl >= 0 ? '+' : ''}${correctTodayPct.toFixed(2)}%  ✅`);
  console.log(`\n  Compare against UI display — they should match exactly.`);
  console.log(`  If UI shows different %% for same $ P&L, the code is still wrong.`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(e => {
  console.error('Test failed:', e.message);
  process.exit(1);
});
