import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data: users, error } = await supabase.auth.admin.listUsers();
  if (error) { console.error('List error:', error); process.exit(1); }

  console.log(`\n📋 ${users.users.length} user(s) found:\n`);
  users.users.forEach((u: any, i: number) => {
    console.log(`  [${i}] ${u.email || '(no email)'} — ID: ${u.id}`);
    console.log(`      Created: ${u.created_at}, Last sign in: ${u.last_sign_in_at || 'never'}`);
    console.log('');
  });
}

main();
