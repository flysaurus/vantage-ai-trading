// ─── POST /api/db/watchlists/create ───────────────────────────
// Creates a new watchlist for the authenticated user.
// Requires: Authorization header with valid Bearer token.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { parseAccountScope, applyAccountScopeFilter, accountScopeColumns } from '@/lib/account-scope';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
    const supabase = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { userId, name, description, isDefault, accountId } = body as {
      userId?: string;
      name?: string;
      description?: string;
      isDefault?: boolean;
      accountId?: string;
    };

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!name || !name.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (userId !== authUserId) {
      return NextResponse.json({ error: 'Cannot create watchlists for other users' }, { status: 403 });
    }

    // Account segregation: resolve the acting account scope (omitted → live default).
    const scope = parseAccountScope(accountId);
    const scopeCols = accountScopeColumns(accountId);

    // If setting as default, reset other defaults first (within the same account).
    if (isDefault) {
      let resetQuery = (supabase as any)
        .from('watchlists')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_default', true);
      if (scope) resetQuery = applyAccountScopeFilter(resetQuery, scope);
      await resetQuery;
    }

    const { data, error } = await (supabase as any)
      .from('watchlists')
      .insert({
        user_id: userId,
        name: name.trim(),
        description: description?.trim() || null,
        stocks: [],
        is_default: isDefault || false,
        connection_id: scopeCols.connection_id,
        is_demo: scopeCols.is_demo,
      })
      .select('id, user_id, name, description, stocks, is_default, created_at')
      .single();

    if (error) {
      console.error('[watchlists/create] Insert failed:', error.message);
      return NextResponse.json({ error: 'Failed to create watchlist', detail: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data.id,
      userId: data.user_id,
      name: data.name,
      description: data.description,
      stocks: data.stocks || [],
      isDefault: data.is_default,
      createdAt: data.created_at,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[watchlists/create] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err?.message }, { status: 500 });
  }
}
