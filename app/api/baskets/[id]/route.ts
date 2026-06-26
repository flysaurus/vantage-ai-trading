import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getOptionalUserId } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getOptionalUserId(req);
  if (userId === 'anonymous') return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = createServerClient() as any;
  const { data: basket } = await supabase.from('baskets').select('*, basket_positions(*)').eq('id', id).eq('user_id', userId).single();

  if (!basket) return NextResponse.json({ error: 'Basket not found' }, { status: 404 });
  return NextResponse.json({ basket });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: patchId } = await params;
  const userId = await getOptionalUserId(req);
  if (userId === 'anonymous') return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const supabase = createServerClient() as any;
  await supabase.from('baskets').update({ status: body.status }).eq('id', patchId).eq('user_id', userId);

  return NextResponse.json({ success: true });
}
