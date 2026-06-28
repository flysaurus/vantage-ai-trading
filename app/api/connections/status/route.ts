// ─── GET /api/connections/status — Current broker connection ──
// Reads connection state from public.users (central identity table).

import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  const { data, error } = await supabase
    .from('users')
    .select('connection_type, connection_status, connection_initiated_at, demo_expires_at')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch connection status' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    connection_type: data?.connection_type ?? null,
    connection_status: data?.connection_status ?? null,
    connection_initiated_at: data?.connection_initiated_at ?? null,
    demo_expires_at: data?.demo_expires_at ?? null,
  });
}
