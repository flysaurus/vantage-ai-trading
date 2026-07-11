// ─── Admin Activity API ──────────────────────────────────────────
// GET /api/admin/users/activity?userId=xxx → audit log for a user
// Gated behind requireAdmin().

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    const supabase = createServerClient();
    const sb = supabase as any;

    const { data: entries, error } = await sb
      .from('admin_audit_log')
      .select('*')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      // Table might not exist yet
      if (error.message?.includes('does not exist')) {
        return NextResponse.json({ entries: [], total: 0, note: 'audit_log table not created yet' });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      userId,
      entries: entries || [],
      total: entries?.length || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
