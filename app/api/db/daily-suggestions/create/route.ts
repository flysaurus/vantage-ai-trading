import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { userId, suggestionText, relatedStocks, actionSuggested, isActedUpon } = body as Record<string, any>;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!suggestionText?.trim()) return NextResponse.json({ error: 'suggestionText required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { data, error } = await (supabase as any).from('daily_suggestions').insert({
      user_id: userId, suggestion_text: suggestionText.trim(),
      related_stocks: relatedStocks || [], action_suggested: actionSuggested || null,
      is_acted_upon: isActedUpon || false,
    }).select('id, suggestion_text, related_stocks, action_suggested, is_acted_upon, created_at').single();
    if (error) return NextResponse.json({ error: 'Failed to create suggestion', detail: error.message }, { status: 500 });
    return NextResponse.json({ id: data.id, suggestionText: data.suggestion_text, relatedStocks: data.related_stocks, actionSuggested: data.action_suggested, isActedUpon: data.is_acted_upon, createdAt: data.created_at });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
