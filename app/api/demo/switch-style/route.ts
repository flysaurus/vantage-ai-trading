/**
 * POST /api/demo/switch-style — Switch demo portfolio to a different investor style.
 *
 * Clears current demo data and seeds a new style portfolio.
 * Only works when user is in demo mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { switchDemoStyle, AVAILABLE_STYLES } from '@/lib/portfolio-operations';
import { getOptionalUserId } from '@/lib/auth';

// ─── Auth (same pattern as chat/daily-brief) ─────────────────
// ─── POST handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const userId = await getOptionalUserId(req);
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
