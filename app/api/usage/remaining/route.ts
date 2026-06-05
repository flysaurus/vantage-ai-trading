import { NextRequest, NextResponse } from 'next/server';
import { checkUsageLimit } from '@/lib/ai-guard';
import { createServerClient } from '@/lib/supabase';

async function getUserIdFromSession(req: NextRequest): Promise<string | null> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (!sessionCookie) return null;

  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sessionCookie),
  );
  const sessionHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    const supabase = createServerClient();
    const { data } = await (supabase as any)
      .from('user_sessions')
      .select('user_id')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (data?.user_id) return data.user_id;
  } catch {
    /* fall through */
  }
  return null;
}

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromSession(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { remaining } = await checkUsageLimit(userId, 'message');
  return NextResponse.json({ remaining, limit: 75 });
}
