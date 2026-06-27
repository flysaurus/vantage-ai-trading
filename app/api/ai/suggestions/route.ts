// ─── GET /api/ai/suggestions ──────────────────────────────
// Fetch AI suggestions for the authenticated user (JWT Bearer auth).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const supabase = createServerClient() as any;
  const { data } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ suggestions: data || [] });
}
