// Diagnose: fetch SnapTrade recentOrders for the Critical Minerals account so
// we can recover the real brokerage_order_id for the 6 recovered basket legs.
import { readFileSync } from 'fs';

// Ensure Supabase URL is set (not present in .env.local — hardcoded project).
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ixjnuoslbzytubpplkot.supabase.co';
}
// Load .env.local values into process.env (dotenv/config loads .env, not .env.local)
try {
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
} catch (e) {
  console.warn('no .env.local', e);
}

async function main() {
  const { resolveSnapTradeCredentials } = await import('@/lib/snaptrade/client');
  const { SnapTradeBroker } = await import('@/lib/broker/snaptrade-broker');

  const USER_ID = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
  const CONNECTION_ID = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

  const creds = await resolveSnapTradeCredentials(USER_ID, CONNECTION_ID);
  console.log('creds:', JSON.stringify({
    snaptradeUserId: creds.snaptradeUserId,
    connectionId: creds.connectionId,
    brokerSlug: creds.brokerSlug,
    brokerConnectionId: creds.brokerConnectionId,
    tradingEnabled: creds.tradingEnabled,
  }));

  const broker = new SnapTradeBroker({
    userId: creds.snaptradeUserId,
    userSecret: creds.snaptradeUserSecret,
    connectionId: creds.connectionId,
    brokerSlug: creds.brokerSlug,
    brokerName: creds.brokerSlug || 'SnapTrade',
    tradingEnabled: creds.tradingEnabled,
  });

  const orders = await broker.getOrders();
  console.log('\nTotal recent orders:', orders.length);
  for (const o of orders) {
    console.log(JSON.stringify({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      status: o.status,
      shares: o.shares,
      filledShares: o.filledShares,
      fillPrice: o.fillPrice,
      totalCost: o.totalCost,
      submittedAt: o.submittedAt,
      filledAt: o.filledAt,
    }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
