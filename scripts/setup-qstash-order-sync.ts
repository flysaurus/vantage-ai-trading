#!/usr/bin/env npx tsx
/**
 * Set up QStash schedule for real-time order-lifecycle sync.
 *
 * Runs every 5 minutes during market hours (13:00–21:00 UTC, weekdays)
 * — matching the existing `execute-pending-orders` schedule — hitting
 * /api/cron/sync-orders to poll SnapTrade recentOrders and persist
 * fill/cancel transitions for in-flight orders.
 *
 * The daily Vercel cron (15 21 * * 1-5) remains as a redundant
 * catch-up in case a QStash run is ever missed.
 *
 * Usage: npx tsx scripts/setup-qstash-order-sync.ts
 */

import { Client } from "@upstash/qstash";

const TOKEN =
  "eyJVc2VySUQiOiJiNDI1YjgyYS1jYjVhLTRlNzQtYTMwNC0yMWYxMGFlYzQ1ZTQiLCJQYXNzd29yZCI6IjZlZTZhY2IyYzYxZDRiMDM4YTQwOWQwZDE3NDIzYTM4In0=";
const BASE_URL = "https://qstash-us-east-1.upstash.io";
const CRON_SECRET = "acb338e4e4ef0c03786100bc489ffba4f5fa681cf73699b08e0af905125dd125";

const ENDPOINT = "https://vantage-ai-trading.vercel.app/api/cron/sync-orders";
const SCHEDULE_ID = "sync-orders";
// 13:00–21:00 UTC (9am–5pm ET) weekdays — every 5 min, matching execute-pending-orders
const SCHEDULE_CRON = "*/5 13-21 * * 1-5";

async function main() {
  const qstash = new Client({ baseUrl: BASE_URL, token: TOKEN });

  console.log("🔧 Setting up QStash schedule for order sync...");
  console.log(`   Schedule: ${SCHEDULE_CRON} UTC`);
  console.log(`   Target:   ${ENDPOINT}`);
  console.log();

  const schedule = await qstash.schedules.create({
    scheduleId: SCHEDULE_ID,
    cron: SCHEDULE_CRON,
    destination: ENDPOINT,
    method: "POST",
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      "Content-Type": "application/json",
    },
    retries: 3,
  });

  console.log("✅ Schedule created/updated successfully!");
  console.log(`   Schedule ID: ${schedule.scheduleId}`);
  console.log(`   Cron:       ${SCHEDULE_CRON}`);
}

main().catch((err: any) => {
  console.error("❌ Setup failed:", err?.message || err);
  if (err?.status === 401 || err?.status === 403) {
    console.error("   → Invalid QSTASH token (check credentials).");
  }
  process.exit(1);
});
