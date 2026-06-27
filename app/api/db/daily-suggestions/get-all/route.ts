import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();
    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('userId') || authUserId;
    const days = parseInt(searchParams.get('days') || '7', 10);
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const since = new Date(); since.setDate(since.getDate() - days);
    const { data, error } = await (supabase as any).from('daily_suggestions')
      .select('id, suggestion_text, related_stocks, action_suggested, is_acted_upon, created_at')
      .eq('user_id', targetUserId).gte('created_at', since.toISOString())
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: 'Failed to fetch suggestions', detail: error.message }, { status: 500 });
    return NextResponse.json({
      suggestions: (data || []).map((s: any) => ({
        id: s.id, suggestionText: s.suggestion_text, relatedStocks: s.related_stocks,
        actionSuggested: s.action_suggested, isActedUpon: s.is_acted_upon, createdAt: s.created_at,
      })),
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
