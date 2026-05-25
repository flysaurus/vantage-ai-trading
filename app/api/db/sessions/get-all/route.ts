import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const targetUserId = req.nextUrl.searchParams.get('userId') || authUserId;
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await (supabase as any).from('sessions')
      .select('id, token, ip_address, user_agent, expires_at, created_at')
      .eq('user_id', targetUserId).order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: 'Failed to fetch sessions', detail: error.message }, { status: 500 });
    return NextResponse.json({ sessions: (data || []).map((s: any) => ({ id: s.id, token: s.token, ipAddress: s.ip_address, userAgent: s.user_agent, expiresAt: s.expires_at, createdAt: s.created_at })) });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
