/**
 * POST /api/cron/send-agent-digest
 *
 * QStash-scheduled — runs once daily (~21:15 UTC / 5:15pm ET).
 * Loops active users with agent_emails_enabled = true, pulls new
 * noticed_items since last_digest_sent_at, sends email digest,
 * and updates last_digest_sent_at.
 *
 * Auth: Bearer token (CRON_SECRET / QSTASH_CRON_SECRET)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import {
  getDigestItemsForUser,
  markDigestSent,
  signUnsubscribeToken,
  renderDigestEmail,
} from '@/lib/digest';

// ── Auth ──
const ALLOWED_SECRETS = [
  process.env.CRON_SECRET || '',
  process.env.QSTASH_CRON_SECRET || '',
].filter(Boolean);

function validateAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  return ALLOWED_SECRETS.some(s => auth === `Bearer ${s}`);
}

// ── POST ──
export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  if (!validateAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient() as any;

  // ── 1. Fetch users with agent_emails_enabled = true ──
  const { data: users, error: userErr } = await supabase
    .from('users')
    .select('id, email, agent_emails_enabled, last_digest_sent_at')
    .eq('agent_emails_enabled', true)
    .not('email', 'is', null);

  // If column doesn't exist yet (migration not applied), fall back gracefully
  if (userErr) {
    if (userErr.message?.includes('agent_emails_enabled')) {
      console.log('[agent-digest] Column agent_emails_enabled not found — migration pending. Skipping.');
      return NextResponse.json({ skipped: 'migration_pending', usersChecked: 0 });
    }
    console.error('[agent-digest] Failed to fetch users:', userErr.message);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }

  if (!users || users.length === 0) {
    console.log('[agent-digest] No users with agent emails enabled');
    return NextResponse.json({ usersChecked: 0, sent: 0, skipped: 0, failures: 0 });
  }

  console.log(`[agent-digest] Starting digest scan — ${users.length} opted-in users`);

  // ── 2. Process each user ──
  let sent = 0;
  let skipped = 0;
  let failures = 0;
  let totalItems = 0;

  for (const user of users) {
    const userId: string = user.id;
    const userEmail: string = user.email;

    try {
      const result = await getDigestItemsForUser(userId);

      if (!result || result.items.length === 0) {
        // No new items — skip this user
        skipped++;
        continue;
      }

      const unsubscribeToken = signUnsubscribeToken(userId);
      const html = renderDigestEmail(result.items, unsubscribeToken);
      const count = result.items.length;

      const subject = `Your Portfolio Agent digest — ${count} update${count !== 1 ? 's' : ''}`;

      try {
        await sendEmail({ to: userEmail, subject, html });
        await markDigestSent(userId);
        sent++;
        totalItems += count;
        console.log(`[agent-digest] ✅ Sent to ${userEmail} — ${count} items`);
      } catch (sendErr: any) {
        failures++;
        console.error(`[agent-digest] ❌ Failed to send to ${userEmail}:`, sendErr.message);
        // Don't rethrow — continue with next user
      }
    } catch (err: any) {
      failures++;
      console.error(`[agent-digest] ❌ Error processing user ${userId.slice(0, 8)}:`, err.message);
      // Continue with next user
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[agent-digest] Complete — ${sent} sent, ${skipped} skipped (no items), ${failures} failed, ${totalItems} total items, ${elapsed}s`);

  return NextResponse.json({
    usersChecked: users.length,
    sent,
    skipped,
    failures,
    totalItems,
    elapsedSeconds: parseFloat(elapsed),
  });
}

export const maxDuration = 55;
