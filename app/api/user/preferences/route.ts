import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

async function getUserIdFromSession(req: NextRequest): Promise<string> {
  const sessionCookie = req.cookies.get('session')?.value || '';
  if (!sessionCookie) return 'anonymous';
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionCookie));
    const sessionHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const supabase = createServerClient();
    const { data } = await (supabase as any).from('user_sessions').select('user_id').eq('session_hash', sessionHash).maybeSingle();
    return data?.user_id || 'anonymous';
  } catch { return 'anonymous'; }
}

const VALID_RISK_VALUES = ['conservative', 'moderate', 'aggressive'];

export async function PATCH(req: NextRequest) {
  const userId = await getUserIdFromSession(req);
  if (userId === 'anonymous') return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  const updates: Record<string, any> = {};

  if (body.risk_tolerance) {
    if (!VALID_RISK_VALUES.includes(body.risk_tolerance)) {
      return NextResponse.json({ error: 'Invalid risk_tolerance value' }, { status: 400 });
    }
    updates.risk_tolerance = body.risk_tolerance;
  }

  if (body.investor_style) {
    updates.investor_style = body.investor_style;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid preferences to update' }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const supabase = createServerClient() as any;
  const { error } = await supabase.from('users').update(updates).eq('id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromSession(req);
  if (userId === 'anonymous') return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = createServerClient() as any;
  const { data } = await supabase.from('users').select('risk_tolerance, investor_style').eq('id', userId).single();

  return NextResponse.json({
    risk_tolerance: data?.risk_tolerance || 'moderate',
    investor_style: data?.investor_style || null,
  });
}
