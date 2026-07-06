// ─── Admin Generation Log API ────────────────────────────────────
// GET  /api/admin/generation-log?userId=xxx&code=ADMIN_ACCESS_CODE → list logs
// POST /api/admin/generation-log → write log entry (called by generation surfaces)
//
// Admin-only — gated behind ADMIN_ACCESS_CODE env var.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

function checkAdmin(code: string | null): boolean {
  const adminCode = process.env.ADMIN_ACCESS_CODE;
  if (!adminCode) return false;
  return code === adminCode;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const code = searchParams.get('code');
  const surface = searchParams.get('surface');
  const limit = parseInt(searchParams.get('limit') || '20');

  if (!checkAdmin(code)) {
    return NextResponse.json({ error: 'Unauthorized — admin access required' }, { status: 401 });
  }

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

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!checkAdmin(code)) {
    return NextResponse.json({ error: 'Unauthorized — admin access required' }, { status: 401 });
  }

  const body = await request.json();
  const { user_id, surface, facts_read, prompt_context, facts_written } = body;

  if (!user_id || !surface) {
    return NextResponse.json(
      { error: 'Missing required fields: user_id, surface' },
      { status: 400 }
    );
  }

  const supabase = createServerClient() as any;

  const { data, error } = await supabase
    .from('ai_generation_log')
    .insert({
      user_id,
      surface,
      facts_read: facts_read || [],
      prompt_context: prompt_context || '',
      facts_written: facts_written || [],
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, log: data });
}
