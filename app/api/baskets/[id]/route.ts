import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

async function getUserIdFromSession(req: NextRequest): Promise<string> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (sessionCookie) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionCookie));
    const sessionHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    try {
      const supabase = createServerClient();
      const { data } = await (supabase as any).from('user_sessions').select('user_id').eq('session_hash', sessionHash).maybeSingle();
      if (data?.user_id) return data.user_id;
    } catch {}
  }
  return 'anonymous';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromSession(req);
  if (userId === 'anonymous') return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = createServerClient() as any;
  const { data: basket } = await supabase.from('baskets').select('*, basket_positions(*)').eq('id', id).eq('user_id', userId).single();

  if (!basket) return NextResponse.json({ error: 'Basket not found' }, { status: 404 });
  return NextResponse.json({ basket });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: patchId } = await params;
  const userId = await getUserIdFromSession(req);
  if (userId === 'anonymous') return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const supabase = createServerClient() as any;
  await supabase.from('baskets').update({ status: body.status }).eq('id', patchId).eq('user_id', userId);

  return NextResponse.json({ success: true });
}
