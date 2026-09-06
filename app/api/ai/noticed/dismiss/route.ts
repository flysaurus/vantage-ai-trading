/**
 * POST /api/ai/noticed/dismiss — Set dismissed_until for a noticed item
 *
 * Body: { itemId: string, dismissType: '3d' | '1w' | 'permanent' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const body = await req.json().catch(() => ({}));
    const { itemId, dismissType } = body as { itemId?: string; dismissType?: string };

    if (!itemId) {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    let dismissedUntil: string | null = null;

    switch (dismissType) {
      case '3d':
        dismissedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case '1w':
        dismissedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        break;
      case 'permanent':
        dismissedUntil = '9999-12-31T23:59:59Z'; // far-future sentinel for permanent
        break;
      default:
        return NextResponse.json({ error: 'Invalid dismissType. Use 3d, 1w, or permanent.' }, { status: 400 });
    }

    const supabase = createServerClient() as any;

    // Verify the item belongs to this user
    const { data: item, error: fetchErr } = await supabase
      .from('noticed_items')
      .select('id, user_id')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single();

    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const { error: updateErr } = await supabase
      .from('noticed_items')
      .update({ dismissed_until: dismissedUntil })
      .eq('id', itemId)
      .eq('user_id', userId);

    if (updateErr) {
      console.error('[noticed/dismiss] Update error:', updateErr.message);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    return NextResponse.json({ success: true, dismissedUntil });
  } catch (err: any) {
    console.error('[noticed/dismiss] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
