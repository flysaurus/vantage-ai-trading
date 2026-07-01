// ─── GET /auth/complete — Email confirmation + setup handler ─
//
// BRIDGE: Stores tokens in sessionStorage so the browser client
// can restore the session via supabase.auth.setSession().
// Server cookies are still set (for middleware refresh),
// but the browser client bypasses cookie read issues entirely.

import { createServerClient } from '@supabase/ssr';
import { createServerClient as createServiceClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  console.log('[auth/complete] HIT — has code:', !!code);

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  let session: any = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data?.session) {
      return NextResponse.redirect(new URL('/login?error=callback_failed', origin));
    }
    session = data.session;
  } else {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session) {
      return NextResponse.redirect(new URL('/login?error=no_code', origin));
    }
    session = data.session;
  }

  console.log('[auth/complete] user:', session.user.id);
  await runSetup(session.user, origin);

  // Base64-encode the token bundle so it's safe to embed in HTML/JS
  const tokenBundle = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
  const encodedBundle = Buffer.from(tokenBundle).toString('base64');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Vantage</title>
<style>
  body{background:#0a0;color:#fff;font-family:system-ui;display:flex;
    align-items:center;justify-content:center;min-height:100vh;
    text-align:center;margin:0}
  h1{font-size:26px;margin:0 0 8px}
  p{font-size:14px;opacity:.8;margin:0 0 20px}
  a#btn{display:none;background:rgba(255,255,255,.15);color:#fff;
    padding:12px 28px;border-radius:8px;text-decoration:none;
    font-weight:600;font-size:15px}
  a#btn:hover{background:rgba(255,255,255,.25)}
  #log{font-family:monospace;font-size:11px;margin-top:20px;
    background:rgba(0,0,0,.2);padding:10px 16px;border-radius:6px;
    max-width:500px;display:inline-block;text-align:left;line-height:1.7}
</style></head>
<body><div>
<h1>✅ Session Ready</h1>
<p id="msg">Storing session…</p>
<a href="/" id="btn">Enter Vantage →</a>
<div id="log"></div>
</div>
<script>
(function(){
  var log=document.getElementById('log'),msg=document.getElementById('msg'),
      btn=document.getElementById('btn');
  function L(t){log.innerHTML+=t+'<br>'}
  try{
    var json=atob('${encodedBundle}');
    var tokens=JSON.parse(json);
    sessionStorage.setItem('vantage-auth-token',json);
    L('sessionStorage: \\u2705 stored');
    L('expires: '+new Date(tokens.expires_at*1000).toLocaleString());
  }catch(e){L('sessionStorage: \\u274c '+e.message)}
  var c=document.cookie,n=c.split(';').map(function(s){return s.trim().split('=')[0]}).filter(Boolean);
  L('Cookies ('+n.length+'): '+(n.join(', ')||'(none)'));
  msg.textContent='Ready. Press Enter Vantage.';
  btn.style.display='inline-block';
})()
</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function runSetup(user: any, origin: string) {
  const serviceClient = createServiceClient();
  const meta = user.user_metadata || {};

  const { data: existingUser } = await (serviceClient as any)
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', user.id)
    .maybeSingle();

  if (existingUser?.demo_start_at || existingUser?.connection_type) {
    console.log('[auth/complete] returning user, skipping setup');
    return;
  }

  const now = new Date().toISOString();

  await (serviceClient as any).from('users').upsert({
    id: user.id, email: user.email || undefined,
    first_name: meta.first_name ?? '', last_name: meta.last_name ?? '',
    investor_style: meta.investor_style ?? null,
    risk_tolerance: meta.risk_tolerance ?? null,
    investor_style_onboarded: true, tier: 'demo',
    first_open: now, last_login_at: now,
  }, { onConflict: 'id', ignoreDuplicates: false });

  const pendingChoice = meta.pending_choice || 'demo';
  if (pendingChoice === 'demo') {
    const expiresAt = new Date(Date.now() + 30*86400000).toISOString();
    await (serviceClient as any).from('users')
      .update({ demo_start_at: now, demo_expires_at: expiresAt, tier: 'demo' })
      .eq('id', user.id);
    const style = meta.investor_style || 'lynch';
    try { await seedDemoPortfolio(user.id, style); } catch(e) {}
  } else if (pendingChoice === 'broker') {
    await (serviceClient as any).from('users').update({
      connection_type: meta.pending_connection_type ?? null,
      connection_status: 'pending', connection_initiated_at: now,
    }).eq('id', user.id);
  }
  console.log('[auth/complete] setup done');
}
