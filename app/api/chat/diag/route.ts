// GET /api/chat/diag — Returns tool-calling deployment status
// Public (no auth) — only returns config status, no model calls
import { NextResponse } from 'next/server';

export async function GET() {
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasFinnhubKey = !!(process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY);
  
  let skHynixResult: any = null;
  if (hasFinnhubKey) {
    try {
      const { resolveSymbol } = await import('@/lib/tools/resolve-symbol');
      const result = await resolveSymbol('SK Hynix');
      skHynixResult = JSON.parse(result);
    } catch (e: any) {
      skHynixResult = { error: e.message };
    }
  }

  return NextResponse.json({
    deployed: true,
    version: 'v3-tool-calling',
    anthropicKey: hasAnthropicKey,
    finnhubKey: hasFinnhubKey,
    skHynix_test: skHynixResult,
  });
}
