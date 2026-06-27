import { NextRequest, NextResponse } from 'next/server';
import { checkUsageLimit } from '@/lib/ai-guard';
import { createServerClient } from '@/lib/supabase';
import { getOptionalUserId } from '@/lib/auth/get-server-user';
export async function GET(req: NextRequest) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { remaining } = await checkUsageLimit(userId, 'message');
  return NextResponse.json({ remaining, limit: 75 });
}
