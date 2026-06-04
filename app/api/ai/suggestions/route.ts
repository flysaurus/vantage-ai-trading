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

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromSession(req);
  if (userId === 'anonymous') return NextResponse.json({ suggestions: [] });
  
  const supabase = createServerClient() as any;
  const { data } = await supabase
    .from('ai_suggestions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  
  return NextResponse.json({ suggestions: data || [] });
}
