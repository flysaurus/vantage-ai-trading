// ─── Broker Disconnect Endpoint ────────────────────────────────
// POST /api/broker/disconnect
//
// Wipes all stored credentials and connection state for the user.
// This is a hard delete — no recovery possible.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { clearCredentials } from '@/lib/vault';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

    // Wipe everything — credentials, hash, broker_id, connection state
    await clearCredentials(userId);

    // Switch back to demo portfolio
    const supabase = createServerClient();
    const { data: user } = await (supabase as any)
      .from('users')
      .select('demo_style, investor_style')
      .eq('id', userId)
      .single();

    const style = user?.demo_style || user?.investor_style || 'lynch';

    // Update user to demo mode first
    await (supabase as any)
      .from('users')
      .update({ broker_connected: false, portfolio_mode: 'demo' })
      .eq('id', userId);

    // Seed demo portfolio
    await seedDemoPortfolio(userId, style);

    return NextResponse.json({ success: true, disconnected: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Disconnect API] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
