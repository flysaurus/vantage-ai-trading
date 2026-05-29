// ─── Broker Disconnect Endpoint ────────────────────────────────
// POST /api/broker/disconnect
//
// Wipes all stored credentials and connection state for the user.
// This is a hard delete — no recovery possible.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { clearCredentials } from '@/lib/vault';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);

    // Wipe everything — credentials, hash, broker_id, connection state
    await clearCredentials(userId);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Disconnect API] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
