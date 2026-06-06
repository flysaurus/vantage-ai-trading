/**
 * POST /api/demo/switch-style — Switch demo portfolio to a different investor style.
 *
 * Clears current demo data and seeds a new style portfolio.
 * Only works when user is in demo mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { switchDemoStyle, AVAILABLE_STYLES } from '@/lib/portfolio-operations';

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

    const { style } = await req.json();

    if (!style || !AVAILABLE_STYLES.includes(style)) {
      return NextResponse.json(
        { error: `Invalid style. Available: ${AVAILABLE_STYLES.join(', ')}` },
        { status: 400 },
      );
    }

    await switchDemoStyle(userId, style);

    return NextResponse.json({ switched: true, style });
  } catch (error: any) {
    console.error('Switch style error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
