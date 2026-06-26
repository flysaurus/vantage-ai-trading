import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read .env.local manually
const envPath = resolve(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m) env[m[1]] = m[2];
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) { console.error('❌', error); process.exit(1); }

  console.log(`\n📋 ${data.users.length} user(s) found:\n`);
  data.users.forEach((u, i) => {
    console.log(`  [${i}] ${u.email || '(no email)'} — ID: ${u.id}`);
    console.log(`      Created: ${u.created_at}, Last sign in: ${u.last_sign_in_at || 'never'}`);
    console.log('');
  });
}

main();
