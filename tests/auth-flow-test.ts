// ─── Auth Flow Test ────────────────────────────────────────────
// Run: npx tsx tests/auth-flow-test.ts

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('❌ Missing env vars');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const testEmail = `test-${Date.now()}@vantage.test`;
  const testPassword = 'TestPass123!';
  const testName = 'Test User';

  // 1. Check if users table exists and what columns it has
  console.log('📋 Checking users table...');
  const { data: allUsers, error: allErr } = await supabase.from('users').select('*').limit(3);
  if (allErr) {
    console.error('❌ Users table query failed:', allErr.message);
  } else {
    console.log('✅ Users table has', allUsers.length, 'rows');
    if (allUsers.length > 0) {
      const cols = Object.keys(allUsers[0]);
      console.log('   Columns:', cols.join(', '));
      // Check for auth columns
      const hasPasswordHash = 'password_hash' in allUsers[0];
      const hasEmailVerified = 'email_verified' in allUsers[0];
      console.log('   Has password_hash column:', hasPasswordHash);
      console.log('   Has email_verified column:', hasEmailVerified);
      // Show first user's auth fields
      const u = allUsers[0] as any;
      console.log('   First user:', { id: u.id, email: u.email, password_hash: u.password_hash?.substring(0, 20), email_verified: u.email_verified });
    }
  }

  // 2. Check email_verification_tokens table
  console.log('\n📋 Checking email_verification_tokens table...');
  const { data: tokens, error: tokErr } = await supabase.from('email_verification_tokens').select('*').limit(3);
  if (tokErr) {
    console.error('❌ Tokens table error:', tokErr.message);
  } else {
    console.log('✅ Tokens table has', tokens.length, 'rows');
  }

  // 3. Test: call the signup API
  console.log(`\n📋 Testing signup with ${testEmail}...`);
  try {
    const res = await fetch('http://localhost:3000/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword, displayName: testName }),
    });
    const data = await res.json();
    console.log('   Status:', res.status);
    console.log('   Response:', JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('   ❌ Signup API call failed:', err.message);
  }

  // 4. Check if user was created in DB
  console.log(`\n📋 Checking if ${testEmail} was created...`);
  const { data: createdUser } = await supabase.from('users').select('*').eq('email', testEmail).single();
  if (createdUser) {
    console.log('✅ User found in DB:');
    const u = createdUser as any;
    console.log('   password_hash exists:', !!u.password_hash);
    console.log('   password_hash length:', u.password_hash?.length);
    console.log('   password_salt exists:', !!u.password_salt);
    console.log('   email_verified:', u.email_verified);
    console.log('   display_name:', u.display_name);
  } else {
    console.log('❌ User NOT found in DB');
  }
}

main().catch(console.error);
