// GET/POST /api/notifications/preferences — order-lifecycle bell preference
// Mirrors the users.order_notifications_enabled column (047 migration).
// Default ON; user-mutable (Em's Option B).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export const maxDuration = 15;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabase = createServerClient();

    const { data, error } = await (supabase as any)
      .from('users')
      .select('order_notifications_enabled')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    // null/undefined → default ON
    const enabled = data?.order_notifications_enabled !== false;
    return NextResponse.json({ order_notifications_enabled: enabled });
  } catch (err: any) {
    console.error('[notifications/preferences] GET Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.order_notifications_enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'order_notifications_enabled must be a boolean' },
      { status: 400 },
    );
  }

  try {
    const supabase = createServerClient();

    const { error } = await (supabase as any)
      .from('users')
      .update({ order_notifications_enabled: body.order_notifications_enabled })
      .eq('id', userId);

    if (error) throw error;

    return NextResponse.json({ order_notifications_enabled: body.order_notifications_enabled });
  } catch (err: any) {
    console.error('[notifications/preferences] POST Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
