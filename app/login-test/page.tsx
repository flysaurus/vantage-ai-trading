// ─── Auth Diagnostic Page ─────────────────────────────────────
// Bare-bones page to test Supabase auth flow directly.
// Visit: /login-test

'use client';

import { useState } from 'react';

export default function LoginTestPage() {
  const [email, setEmail] = useState('mparikh01@yahoo.com');
  const [password, setPassword] = useState('');
  const [output, setOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const log = (msg: string) => setOutput(prev => [...prev, `${new Date().toISOString().slice(11, 19)} ${msg}`]);

  const testAuth = async () => {
    setOutput([]);
    setLoading(true);

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      log(`SUPABASE_URL: ${url || '❌ MISSING'}`);
      log(`SUPABASE_ANON_KEY: ${key ? '✅ present (' + key.substring(0, 20) + '...)' : '❌ MISSING'}`);

      if (!url || !key) {
        log('❌ Cannot proceed — env vars missing');
        setLoading(false);
        return;
      }

      // Dynamic import to test exact same createClient as login page
      const { createClient } = await import('@/lib/supabase');
      let supabase: any;
      try {
        supabase = createClient();
        log('✅ createClient() succeeded');
      } catch (e: any) {
        log(`❌ createClient() threw: ${String(e?.message || e)}`);
        setLoading(false);
        return;
      }

      log(`📡 Calling signInWithPassword("${email}", "***")...`);
      const t0 = Date.now();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      const ms = Date.now() - t0;

      if (error) {
        log(`❌ Error after ${ms}ms`);
        log(`   status: ${error.status}`);
        log(`   name: ${error.name}`);
        log(`   message type: ${typeof error.message}`);
        log(`   message raw: ${JSON.stringify(error.message)}`);
        log(`   message str: ${String(error.message)}`);
      } else if (data?.user && data?.session) {
        log(`✅ SUCCESS after ${ms}ms`);
        log(`   user.id: ${data.user.id}`);
        log(`   user.email: ${data.user.email}`);
        log(`   session.expires_at: ${data.session.expires_at}`);
        log(`   token prefix: ${data.session.access_token.substring(0, 20)}...`);
      } else {
        log(`⚠️ Unexpected response after ${ms}ms`);
        log(`   has user: ${!!data?.user}`);
        log(`   has session: ${!!data?.session}`);
        log(`   data keys: ${Object.keys(data || {})}`);
      }
    } catch (e: any) {
      log(`💥 Unhandled exception:`);
      log(`   ${String(e?.message || e)}`);
      log(`   type: ${typeof e}`);
      log(`   constructor: ${e?.constructor?.name || 'unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: '#0a0e27', color: '#e2e8f0', minHeight: '100dvh',
      padding: 20, fontFamily: 'monospace', fontSize: 13,
    }}>
      <h1 style={{ fontSize: 18, color: '#06b6d4' }}>Auth Diagnostic</h1>

      <div style={{ margin: '16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
          style={{ padding: 8, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0' }}
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          style={{ padding: 8, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0' }}
        />
        <button
          onClick={testAuth}
          disabled={loading}
          style={{
            padding: '10px 16px', background: loading ? '#334155' : '#06b6d4',
            border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Testing...' : 'Test Sign In'}
        </button>
      </div>

      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
        padding: 12, minHeight: 200, maxHeight: '60vh', overflow: 'auto',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>
        {output.length === 0 ? 'Waiting for test...' : output.map((line, i) => (
          <div key={i} style={{
            padding: '2px 0',
            color: line.includes('❌') ? '#f87171' : line.includes('✅') ? '#22c55e' : line.includes('⚠️') ? '#facc15' : '#94a3b8',
          }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
