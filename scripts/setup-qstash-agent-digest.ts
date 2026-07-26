#!/usr/bin/env npx tsx
/**
 * Set up QStash schedule for the daily Agent Email Digest.
 *
 * Runs once daily at 21:15 UTC (5:15pm ET) — just after market close,
 * so the digest can include the day's full activity.
 *
 * Hits the /api/cron/send-agent-digest endpoint.
 *
 * Usage: npx tsx scripts/setup-qstash-agent-digest.ts
 */

import { Client } from "@upstash/qstash";

const TOKEN = "eyJVc2VySUQiOiJiNDI1YjgyYS1jYjVhLTRlNzQtYTMwNC0yMWYxMGFlYzQ1ZTQiLCJQYXNzd29yZCI6IjZlZTZhY2IyYzYxZDRiMDM4YTQwOWQwZDE3NDIzYTM4In0=";
const BASE_URL = "https://qstash-us-east-1.upstash.io";
const CRON_SECRET = "acb338e4e4ef0c03786100bc489ffba4f5fa681cf73699b08e0af905125dd125";

const ENDPOINT = "https://vantage-ai-trading.vercel.app/api/cron/send-agent-digest";
const SCHEDULE_ID = "agent-digest";
// 21:15 UTC = 17:15 ET (after market close)
const SCHEDULE_CRON = "15 21 * * *";

async function main() {
  const qstash = new Client({ baseUrl: BASE_URL, token: TOKEN });

  console.log("🔧 Setting up QStash schedule for Agent Email Digest...");
  console.log(`   Schedule: ${SCHEDULE_CRON} UTC (21:15 UTC / 5:15pm ET)`);
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
    console.log("   5-min orders:            96 msgs/day");
    console.log("   Portfolio Agent (30-min): 16 msgs/day");
    console.log("   Agent Digest (daily):      1 msg/day");
    console.log("   Total:                   113 msgs/day");
    console.log("   QStash free:             500 msgs/day");
    console.log("   Headroom:                387 spare ✅");
    console.log();
    console.log("📋 Next steps:");
    console.log("   1. Apply DB migration: supabase/migrations/agent_digest.sql");
    console.log("   2. Deploy to Vercel (this route must exist)");
    console.log("   3. Verify migration — agent_emails_enabled + last_digest_sent_at columns");
    console.log("   4. Check Vercel logs for test run delivery");
    console.log("   5. Unsubscribe link: https://vantage-ai-trading.vercel.app/api/agent-emails/unsubscribe?token={token}");
  } catch (err: any) {
    console.error("❌ Setup failed:", err.message);
    if (err.status === 401 || err.status === 403) {
      console.error("   → Invalid QSTASH token (check credentials)");
    }
    if (err.message?.includes("already exists")) {
      console.error("   → Schedule ID 'agent-digest' already exists. Delete it first or use a new ID.");
    }
    process.exit(1);
  }
}

main();
