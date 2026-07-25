#!/usr/bin/env npx tsx
/**
 * Set up Upstash QStash cron — us-east-1 region.
 *
 * Usage: npx tsx scripts/setup-qstash-us.ts
 */

import { Client } from "@upstash/qstash";

const TOKEN = "eyJVc2VySUQiOiJiNDI1YjgyYS1jYjVhLTRlNzQtYTMwNC0yMWYxMGFlYzQ1ZTQiLCJQYXNzd29yZCI6IjZlZTZhY2IyYzYxZDRiMDM4YTQwOWQwZDE3NDIzYTM4In0=";
const BASE_URL = "https://qstash-us-east-1.upstash.io";
const CRON_SECRET = "acb338e4e4ef0c03786100bc489ffba4f5fa681cf73699b08e0af905125dd125";

const ENDPOINT = "https://vantage-ai-trading.vercel.app/api/cron/execute-pending-orders";
const SCHEDULE_ID = "execute-pending-orders";
const SCHEDULE_CRON = "*/5 13-21 * * 1-5"; // Every 5 min during US market hours (UTC)

async function main() {
  const qstash = new Client({ baseUrl: BASE_URL, token: TOKEN });

  console.log("🔧 Setting up QStash schedule (us-east-1)...");
  console.log(`   Schedule: ${SCHEDULE_CRON}`);
  console.log(`   Target:   ${ENDPOINT}`);
  console.log();

  try {
    const schedule = await qstash.schedules.create({
      scheduleId: SCHEDULE_ID,
      cron: SCHEDULE_CRON,
      destination: ENDPOINT,
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      retries: 3,
      callback: undefined,
    });

    console.log("✅ Schedule created successfully!");
    console.log(`   Schedule ID: ${schedule.scheduleId}`);
    console.log();

    // Manual test
    console.log("🧪 Triggering manual test run...");
    const testResult = await qstash.publish({
      url: ENDPOINT,
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      retries: 1,
    });

    console.log(`   Message ID: ${testResult.messageId}`);
    console.log("   ✅ Test message published — check Vercel logs for delivery");
    console.log();

    console.log("📊 Free Tier Math:");
    console.log("   Calls/day:  12/hr × 8 market hours = 96");
    console.log("   QStash free: 500 msgs/day");
    console.log("   Headroom:    500 - 96 = 404 spare (5.2x margin) ✅");
    console.log();
    console.log("📋 Next steps:");
    console.log("   1. Deploy route.ts change to Vercel (accepts QSTASH_CRON_SECRET)");
    console.log("   2. Check QStash dashboard for delivery logs");
    console.log("   3. Verify Vercel logs show successful executions");
    console.log("   4. Disable GitHub Actions workflow (scripts/disable-gh-cron.sh)");
  } catch (err: any) {
    console.error("❌ Setup failed:", err.message);
    if (err.status === 401 || err.status === 403) {
      console.error("   → Invalid QSTASH token");
    }
    process.exit(1);
  }
}

main();
