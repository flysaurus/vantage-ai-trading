import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const cookieStore = await cookies();
  
  // Simulate what Supabase SSR does: set a test cookie
  cookieStore.set('test-sb-cookie', 'test-value-123', {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60,
  });

  const allCookies = cookieStore.getAll();
  console.log('[test-cookie] set cookies:', allCookies.map(c => c.name).join(', '));

  const html = `<!DOCTYPE html><html><body>
    <h1>Cookie test</h1>
    <p id="cookies"></p>
    <script>
      document.getElementById('cookies').textContent = 
        'document.cookie: ' + document.cookie;
    </script>
  </body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
