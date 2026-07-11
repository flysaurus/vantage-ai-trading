// ─── Admin Generation Log API ────────────────────────────────────
// GET  /api/admin/generation-log?userId=xxx → list logs
//
// Gated behind requireAdmin() (JWT-based, not shared ADMIN_ACCESS_CODE).
// POST endpoint removed — generation surfaces write directly to DB via lib/ai/generation-log.ts.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { adminError } = await requireAdmin(request);
  if (adminError) return adminError;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const surface = searchParams.get('surface');
  const limit = parseInt(searchParams.get('limit') || '20');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  const supabase = createServerClient() as any;

  let query = supabase
    .from('ai_generation_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (surface) {
    query = query.eq('surface', surface);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    userId,
    surface: surface || 'all',
    count: data?.length || 0,
    logs: data || [],
  });
}
