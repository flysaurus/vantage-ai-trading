#!/usr/bin/env npx tsx
/**
 * Set up QStash schedule for Portfolio Agent (us-east-1 region).
 *
 * Runs every 30 minutes during US market hours (13-21 UTC, Mon-Fri).
 * Hits the /api/cron/portfolio-agent endpoint.
 *
 * Usage: npx tsx scripts/setup-qstash-portfolio-agent.ts
 */

import { Client } from "@upstash/qstash";

const TOKEN = "eyJVc2VySUQiOiJiNDI1YjgyYS1jYjVhLTRlNzQtYTMwNC0yMWYxMGFlYzQ1ZTQiLCJQYXNzd29yZCI6IjZlZTZhY2IyYzYxZDRiMDM4YTQwOWQwZDE3NDIzYTM4In0=";
const BASE_URL = "https://qstash-us-east-1.upstash.io";
const CRON_SECRET = "acb338e4e4ef0c03786100bc489ffba4f5fa681cf73699b08e0af905125dd125";

const ENDPOINT = "https://vantage-ai-trading.vercel.app/api/cron/portfolio-agent";
const SCHEDULE_ID = "portfolio-agent";
const SCHEDULE_CRON = "*/30 13-21 * * 1-5"; // Every 30 min during US market hours

async function main() {
  const qstash = new Client({ baseUrl: BASE_URL, token: TOKEN });

  console.log("🔧 Setting up QStash schedule for Portfolio Agent...");
  console.log(`   Schedule: ${SCHEDULE_CRON}`);
  console.log(`   Target:   ${ENDPOINT}`);
  console.log();

  try {
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
      callback: undefined,
    });

    console.log("✅ Schedule created successfully!");
    console.log(`   Schedule ID: ${schedule.scheduleId}`);
    console.log();

    // Manual test
    console.log("🧪 Triggering manual test run...");
    const testResult = await qstash.publish({
      url: ENDPOINT,
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      retries: 1,
    });

    console.log(`   Message ID: ${testResult.messageId}`);
    console.log("   ✅ Test message published — check Vercel logs for delivery");
    console.log();

    console.log("📊 Free Tier Usage:");
    console.log("   Existing (5-min orders):  96 msgs/day");
    console.log("   Portfolio Agent (30-min): 16 msgs/day");
    console.log("   Total:                    112 msgs/day");
    console.log("   QStash free:              500 msgs/day");
    console.log("   Headroom:                 388 spare (4.5x margin) ✅");
    console.log();
    console.log("📋 Next steps:");
    console.log("   1. Deploy to Vercel (portfolio-agent route must exist)");
    console.log("   2. Check QStash dashboard for delivery logs");
    console.log("   3. Verify Vercel logs show successful executions");
    console.log("   4. Monitor noticed_items table for new scheduled entries");
  } catch (err: any) {
    console.error("❌ Setup failed:", err.message);
    if (err.status === 401 || err.status === 403) {
      console.error("   → Invalid QSTASH token (check credentials)");
    }
    if (err.status === 404) {
      console.error("   → Endpoint not found (deploy first!)");
    }
    if (err.message?.includes("already exists")) {
      console.error("   → Schedule ID already exists. Delete it first or use a new ID.");
    }
    process.exit(1);
  }
}

main();
