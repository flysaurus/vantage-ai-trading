import { NextRequest, NextResponse } from 'next/server';
import { checkUsageLimit } from '@/lib/ai-guard';
import { getOptionalUserId } from '@/lib/auth/get-server-user';

export async function GET(req: NextRequest) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const chatCheck = await checkUsageLimit(userId, 'message');
  const deepCheck = await checkUsageLimit(userId, 'deepAnalysis');

  return NextResponse.json({
    chatRemaining: chatCheck.remaining,
    deepRemaining: deepCheck.remaining,
  });
}
