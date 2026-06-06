/**
 * POST /api/ai/cache/clear — Clear AI cache for the current user.
 *
 * Deletes daily_briefs and weekly_snapshots so next request regenerates.
 * Useful after portfolio changes or when demo style is switched.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// ─── Auth (same pattern as chat/daily-brief) ─────────────────

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
    return data?.user_id || null;
  } catch {
    return null;
  }
}

// ─── POST handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromSession(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();

    await Promise.all([
      (supabase as any).from('daily_briefs').delete().eq('user_id', userId),
      (supabase as any).from('weekly_snapshots').delete().eq('user_id', userId),
    ]);

    return NextResponse.json({ cleared: true });
  } catch (error: any) {
    console.error('Cache clear error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
