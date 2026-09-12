// ─── POST /api/strategies/tax-harvest/export ────────────────
// Generates the Excel (.xlsx) download for a Tax Loss Harvesting plan.
//
// READ-ONLY FRIENDLY BY DESIGN: this endpoint never places an order and never
// touches a broker — it only serializes the harvest plan the client already
// computed (one row per harvester position). View-only connections are expected
// to download and execute elsewhere, so the download path must work for them
// even though Execute is disabled. There is NO trading-capability gate here.
//
// Auth-gated via requireAuth; the payload is the caller's own plan.
// Transport only: workbook layout lives in lib/export/tax-harvest-export.ts.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  buildTaxHarvestPlanWorkbook,
  normalizeTaxHarvestExportInput,
  taxHarvestExportFilename,
} from '@/lib/export/tax-harvest-export';

export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth(req);
  if (authError || !authUser) return authError;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Whitelist + validate in the shared normalizer (unit-tested). It carries
  // `preciseSavings` and `illustrative` through — the split between dated
  // positions and undated ones is what keeps a plan from reporting a single
  // blended figure as if every position had been classified.
  const generatedAt = new Date();
  const input = normalizeTaxHarvestExportInput(body, generatedAt);

  if (!input) {
    return NextResponse.json(
      { error: 'Nothing to export — no harvester positions provided' },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = await buildTaxHarvestPlanWorkbook(input);
  } catch (err) {
    console.error('[tax-harvest-export] workbook build failed:', err);
    return NextResponse.json({ error: 'Failed to generate plan export' }, { status: 500 });
  }

  const filename = taxHarvestExportFilename({
    accountName: input.accountName,
    generatedAt,
  });
  const bytes = new Uint8Array(buffer);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
}
