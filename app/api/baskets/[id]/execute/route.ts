import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

async function getUserIdFromSession(req: NextRequest): Promise<string> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (sessionCookie) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionCookie));
    const sessionHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    try {
      const supabase = createServerClient();
      const { data } = await (supabase as any).from('user_sessions').select('user_id').eq('session_token_hash', sessionHash).maybeSingle();
      if (data?.user_id) return data.user_id;
    } catch {}
  }
  return 'anonymous';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserIdFromSession(req);
  if (userId === 'anonymous') return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const { orders } = body;
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return NextResponse.json({ error: 'No orders provided' }, { status: 400 });
  }

  const supabase = createServerClient() as any;
  const results: Array<{ symbol: string; status: string; error?: string }> = [];

  for (const order of orders) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/alpaca/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': req.headers.get('cookie') || '' },
        body: JSON.stringify({
          symbol: order.symbol,
          qty: order.qty,
          side: 'buy',
          type: order.orderType || 'market',
          time_in_force: order.timeInForce || 'day',
          limit_price: order.limitPrice || undefined,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        results.push({ symbol: order.symbol, status: 'filled' });
        await supabase.from('basket_positions').update({ status: 'ordered' }).eq('basket_id', id).eq('symbol', order.symbol).eq('user_id', userId);
      } else {
        results.push({ symbol: order.symbol, status: 'failed', error: json.error || json.message || 'Unknown error' });
      }
    } catch (e: any) {
      results.push({ symbol: order.symbol, status: 'failed', error: e.message });
    }
  }

  // Update basket to 'active'
  const allFilled = results.every(r => r.status === 'filled');
  if (allFilled) {
    await supabase.from('baskets').update({ status: 'active' }).eq('id', id).eq('user_id', userId);
  }

  return NextResponse.json({ success: allFilled, results });
}
