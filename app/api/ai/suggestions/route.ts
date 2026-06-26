// ─── GET /api/ai/suggestions ──────────────────────────────
// Fetch AI suggestions for the authenticated user (JWT Bearer auth).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireAuth(req));
  } catch {
    return NextResponse.json({ suggestions: [] });
  }

  const supabase = createServerClient() as any;
  const { data } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ suggestions: data || [] });
}
