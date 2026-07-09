// ─── GET /api/usage/remaining ──────────────────────────────
// Quick remaining-count check for chat guard.
// Accepts ?localDate=YYYY-MM-DD for user's timezone.

import { NextRequest, NextResponse } from 'next/server';
import { checkUsageLimit, getLocalDateFromTimezone } from '@/lib/ai-guard';
import { getOptionalUserId } from '@/lib/auth/get-server-user';

export async function GET(req: NextRequest) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const localDate = searchParams.get('localDate') || getLocalDateFromTimezone();

  const chatCheck = await checkUsageLimit(userId, 'message', localDate);
  const deepCheck = await checkUsageLimit(userId, 'deepAnalysis', localDate);

  return NextResponse.json({
    chatRemaining: chatCheck.remaining,
    deepRemaining: deepCheck.remaining,
  });
}
