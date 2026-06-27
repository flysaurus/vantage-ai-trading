// ─── GET /api/debug/cookies — Diagnostic endpoint ───────────
// Shows what cookies the server receives. Helps debug auth issues.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerUser } from '@/lib/auth/get-server-user';

export async function GET() {
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();
  
  const user = await getServerUser();
  
  return NextResponse.json({
    cookieCount: allCookies.length,
    cookieNames: allCookies.map(c => ({ name: c.name, valuePrefix: c.value.substring(0, 20) + '...' })),
    userFound: !!user,
    userEmail: user?.email || null,
    userId: user?.id || null,
  });
}
