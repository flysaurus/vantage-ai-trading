// ─── POST /api/auth/logout ──────────────────────────────────────
// Deletes the session from DB and clears the session cookie.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { hashSessionToken } from '@/lib/crypto';

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log('👉 [API] Logout request');

  const sessionToken = req.cookies.get('session')?.value;

  if (sessionToken) {
    try {
      const supabase = createServerClient();
      const sessionTokenHash = hashSessionToken(sessionToken);

      await (supabase as any)
        .from('sessions')
        .delete()
        .eq('session_token_hash', sessionTokenHash);

      console.log('✅ Session deleted');
    } catch (err) {
      console.error('❌ Session deletion error:', err);
    }
  }

  // Clear cookie
  const response = NextResponse.json(
    { success: true, message: 'Logged out successfully' },
    { status: 200 }
  );

  response.cookies.delete('session');

  return response;
}
