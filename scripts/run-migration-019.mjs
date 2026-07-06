// Quick migration runner — creates ai_generation_log table
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const sql = `
CREATE TABLE IF NOT EXISTS ai_generation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  surface         TEXT NOT NULL,
  facts_read      JSONB DEFAULT '[]',
  prompt_context  TEXT DEFAULT '',
  facts_written   JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_log_user_surface
  ON ai_generation_log(user_id, surface, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_gen_log_surface
  ON ai_generation_log(surface, created_at DESC);

ALTER TABLE ai_generation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users own generation logs" ON ai_generation_log;
CREATE POLICY "Users own generation logs" ON ai_generation_log
  FOR ALL
  USING (user_id = (SELECT id FROM users WHERE id = auth.uid()))
  WITH CHECK (user_id = (SELECT id FROM users WHERE id = auth.uid()));
`;

  // Try the SQL endpoint
  const { data, error } = await supabase.rpc('run_sql', { query: sql }).maybeSingle();
  
  if (error) {
    console.log('RPC failed, trying direct check...');
    // Try to select from the table to see if it exists
    const { error: checkErr } = await supabase.from('ai_generation_log').select('id').limit(1);
    if (checkErr && checkErr.message.includes('does not exist')) {
      console.error('Table does not exist and could not be created via RPC.');
      console.error('Please run supabase/migrations/019_ai_generation_log.sql in the Supabase SQL Editor.');
      process.exit(1);
    } else if (checkErr) {
      console.error('Select error:', checkErr.message);
    } else {
      console.log('Table already exists.');
    }
  } else {
    console.log('Migration executed successfully.');
  }
}

main().catch(console.error);
