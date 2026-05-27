import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { userId, token, ipAddress, userAgent, expiresAt } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
    if (!expiresAt) return NextResponse.json({ error: 'expiresAt required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await (supabase as any).from('user_sessions').insert({
      user_id: userId, token, ip_address: ipAddress || null,
      user_agent: userAgent || null, expires_at: expiresAt,
    }).select('id, user_id, expires_at, created_at').single();
    if (error) return NextResponse.json({ error: 'Failed to create session', detail: error.message }, { status: 500 });
    return NextResponse.json({ id: data.id, userId: data.user_id, expiresAt: data.expires_at, createdAt: data.created_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
