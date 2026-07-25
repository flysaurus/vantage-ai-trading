#!/usr/bin/env npx tsx
/**
 * Set up Upstash QStash cron schedule for basket/order execution.
 *
 * Usage: QSTASH_TOKEN=xxx npx tsx scripts/setup-qstash.ts
 *
 * Creates a recurring schedule that hits the existing
 * /api/cron/execute-pending-orders endpoint every 5 minutes
 * during market hours (Mon-Fri 13:00-21:00 UTC).
 *
 * Free tier: 500 msgs/day — we use 96/day (12/hr × 8h) = 19% of quota.
 */

import { Client } from "@upstash/qstash";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

if (!QSTASH_TOKEN) {
  console.error("❌ QSTASH_TOKEN environment variable required.");
  console.error("   Get it from https://console.upstash.com/qstash");
  process.exit(1);
}

if (!CRON_SECRET) {
  console.error("❌ CRON_SECRET environment variable required.");
  console.error("   This is the same secret used by the GitHub Actions workflow.");
  process.exit(1);
}

const ENDPOINT = "https://vantage-ai-trading.vercel.app/api/cron/execute-pending-orders";
const SCHEDULE_ID = "execute-pending-orders";
const SCHEDULE_CRON = "*/5 13-21 * * 1-5"; // Every 5 min during US market hours (UTC)

async function main() {
  const qstash = new Client({ token: QSTASH_TOKEN });

  console.log("🔧 Setting up QStash schedule...");
  console.log(`   Schedule: ${SCHEDULE_CRON}`);
  console.log(`   Target:   ${ENDPOINT}`);
  console.log();

  try {
    // Create (or update) the schedule
    const schedule = await qstash.schedules.create({
      scheduleId: SCHEDULE_ID,
      cron: SCHEDULE_CRON,
      destination: ENDPOINT,
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      // Retry on failure: 3 attempts with 30s backoff
      retries: 3,
      // QStash delivers the response back — we don't need it for fire-and-forget
      callback: undefined,
    });

    console.log("✅ Schedule created successfully!");
    console.log(`   Schedule ID: ${schedule.scheduleId}`);
    console.log();

    // Verify with a manual test
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
    console.log("   1. Check QStash dashboard for delivery logs");
    console.log("   2. Verify Vercel logs show successful executions");
    console.log("   3. Disable GitHub Actions workflow (scripts/disable-gh-cron.sh)");
  } catch (err: any) {
    console.error("❌ Setup failed:", err.message);
    if (err.status === 401 || err.status === 403) {
      console.error("   → Invalid QSTASH_TOKEN — check your token at https://console.upstash.com");
    }
    process.exit(1);
  }
}

main();
