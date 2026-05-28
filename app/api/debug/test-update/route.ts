// ─── GET /api/debug/test-update ──────────────────────────────
// Tests all methods for updating email_verified on a given user
// Hit this directly to see which approaches work

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({
      usage: 'GET /api/debug/test-update?userId=<uuid>',
      tip: 'Grab the id of the unverified user from your users table'
    }, { status: 400 });
  }

  const results: Record<string, any> = {};
  const supabase = createServerClient();

  // 1. Read current state
  const { data: before } = await supabase.from('users')
    .select('id, email, email_verified, email_verified_at').eq('id', userId).single();
  results.before = before;

  if (!before) {
    return NextResponse.json({ error: 'User not found', userId }, { status: 404 });
  }

  if (before.email_verified) {
    return NextResponse.json({ message: 'Already verified', before });
  }

  // 2. Try JS client .update()
  const u1 = await supabase.from('users')
    .update({ email_verified: true, email_verified_at: new Date().toISOString() })
    .eq('id', userId)
    .select('email_verified');
  results.jsUpdate = { error: u1.error?.message || null, data: u1.data };

  // Reset
  await supabase.from('users').update({ email_verified: false, email_verified_at: null }).eq('id', userId);

  // 3. Try RPC
  const u2 = await supabase.rpc('verify_user_email_now', { p_user_id: userId });
  results.rpc = { error: (u2 as any).error?.message || null, data: u2.data };

  // Reset
  await supabase.from('users').update({ email_verified: false, email_verified_at: null }).eq('id', userId);

  // 4. Try direct REST PATCH
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ email_verified: true, email_verified_at: new Date().toISOString() }),
    });
    results.restPatch = { status: r.status, ok: r.ok, body: await r.text() };
  } catch (e: any) {
    results.restPatch = { error: e.message };
  }

  // Reset
  await supabase.from('users').update({ email_verified: false, email_verified_at: null }).eq('id', userId);

  // 5. Try direct RPC via fetch
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/verify_user_email_now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_user_id: userId }),
    });
    results.rpcViaFetch = { status: r.status, ok: r.ok, body: await r.text() };
  } catch (e: any) {
    results.rpcViaFetch = { error: e.message };
  }

  // Final state
  const { data: after } = await supabase.from('users')
    .select('email_verified, email_verified_at').eq('id', userId).single();
  results.after = after;

  return NextResponse.json(results, { status: 200 });
}
