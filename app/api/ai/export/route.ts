import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { buildExportCsv, exportFilenameStem, type ExportPayload } from '@/lib/export/csv';

export const maxDuration = 60;

/**
 * POST /api/ai/export
 * Body: { title, subtitle?, thesis?, grandTotal?, rows: ExportRow[] }
 * Generates the shared CSV download for AI Advisor structured
 * responses (rebalance plans, portfolio builds, basket previews, etc.).
 *
 * Auth-gated; the payload is derived from the user's own conversation, so no
 * additional scoping is required. Returns an attachment stream (no email).
 */
export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth(req);
  if (authError || !authUser) return authError;

  let body: Partial<ExportPayload> & { rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: 'No export rows provided' }, { status: 400 });
  }

  // Lightweight validation + sanitization so a malformed payload can't 500.
  const rows = body.rows.slice(0, 500).map((r: any) => ({
    ticker: String(r?.ticker ?? '').toUpperCase().slice(0, 10),
    company: r?.company != null ? String(r.company).slice(0, 80) : null,
    action: ['buy', 'sell', 'hold'].includes(r?.action) ? (r.action as 'buy' | 'sell' | 'hold') : 'hold',
    qty: typeof r?.qty === 'number' && Number.isFinite(r.qty) ? r.qty : null,
    amountUsd: typeof r?.amountUsd === 'number' && Number.isFinite(r.amountUsd) ? r.amountUsd : null,
    price: typeof r?.price === 'number' && Number.isFinite(r.price) ? r.price : null,
    lineTotal: typeof r?.lineTotal === 'number' && Number.isFinite(r.lineTotal) ? r.lineTotal : null,
    note: r?.note != null ? String(r.note).slice(0, 500) : null,
  })).filter((r: any) => r.ticker.length > 0);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid export rows' }, { status: 400 });
  }

  const title = String(body.title ?? 'Vantage Export').slice(0, 120);
  const payload: ExportPayload = {
    title,
    subtitle: body.subtitle ? String(body.subtitle).slice(0, 200) : null,
    thesis: body.thesis ? String(body.thesis).slice(0, 5000) : null,
    grandTotal: typeof body.grandTotal === 'number' && Number.isFinite(body.grandTotal) ? body.grandTotal : null,
    rows,
  };

  let csv: string;
  try {
    csv = buildExportCsv(payload);
  } catch (err) {
    console.error('[export] CSV build failed:', err);
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 });
  }

  const filename = `${exportFilenameStem(title)}.csv`;
  // Prepend a UTF-8 BOM so Excel/Sheets detect the encoding (non-ASCII names).
  const bodyBytes = Buffer.from('\uFEFF' + csv, 'utf-8');
  return new NextResponse(bodyBytes, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bodyBytes.length),
      'Cache-Control': 'no-store',
    },
  });
}
