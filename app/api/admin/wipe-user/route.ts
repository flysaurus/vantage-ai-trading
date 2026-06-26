// ─── Temporary user data wipe ───────────────────────────────
// DELETE AFTER USE. Requires service role key (only on Vercel).
// Call: POST /api/admin/wipe-user { email: "...", wipeKey: "vantage-wipe-confirmed" }

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// GET: list all users (require same wipeKey)
export async function GET(req: NextRequest) {
  const wipeKey = req.nextUrl.searchParams.get('key');
  if (wipeKey !== 'vantage-wipe-confirmed') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const supabase = createServerClient();
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    count: data.users.length,
    users: data.users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { email, wipeKey } = await req.json();

    if (wipeKey !== 'vantage-wipe-confirmed') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();

    const { data: userList, error: findError } =
      await supabase.auth.admin.listUsers();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    const user = userList.users.find(
      (u) => u.email?.toLowerCase() === email?.toLowerCase(),
    );

    if (!user) {
      return NextResponse.json(
        {
          error: `No user found with email: ${email}`,
          users: userList.users.map((u) => u.email),
        },
        { status: 404 },
      );
    }

    const userId = user.id;
    const results: Record<string, string> = {};

    // Tables where the user FK column is 'id'
    const byId = ['user_profiles', 'users'];
    for (const table of byId) {
      const { error } = await supabase.from(table).delete().eq('id', userId);
      results[table] = error ? `❌ ${error.message}` : '✅';
    }

    // Tables where the user FK column is 'user_id'
    const byUserId = [
      'portfolio_analysis', 'trade_history', 'ai_suggestions',
      'alerts', 'chat_history', 'chat_messages', 'watchlists',
      'strategies', 'metrics', 'account_snapshots', 'vault',
    ];
    for (const table of byUserId) {
      const { error } = await supabase.from(table).delete().eq('user_id', userId);
      results[table] = error ? `❌ ${error.message}` : '✅';
    }

    // Delete auth user
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    results['auth.users'] = authError ? `❌ ${authError.message}` : '✅';

    return NextResponse.json({
      success: true,
      userId,
      email: user.email,
      results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
