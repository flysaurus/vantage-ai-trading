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
  taxHarvestExportFilename,
  type TaxHarvestExportPosition,
  type TaxHarvestPlanExportInput,
} from '@/lib/export/tax-harvest-export';

export const maxDuration = 60;

/** Clamp/validate a number coming from the client. */
function num(v: unknown, fallback: number | null = null): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, max = 120): string | null {
  return v != null && String(v).trim().length > 0 ? String(v).trim().slice(0, max) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth(req);
  if (authError || !authUser) return authError;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawPositions: any[] = Array.isArray(body?.positions) ? body.positions.slice(0, 500) : [];
  const positions: TaxHarvestExportPosition[] = rawPositions
    .map((p) => ({
      symbol: String(p?.symbol ?? '').toUpperCase().slice(0, 12),
      name: str(p?.name, 80),
      qty: num(p?.qty, 0) ?? 0,
      costBasis: num(p?.costBasis, 0) ?? 0,
      marketValue: num(p?.marketValue, 0) ?? 0,
      unrealizedLoss: num(p?.unrealizedLoss, 0) ?? 0,
      unrealizedLossPct: num(p?.unrealizedLossPct, 0) ?? 0,
      washSaleStatus: str(p?.washSaleStatus, 80),
      washSaleSafe: typeof p?.washSaleSafe === 'boolean' ? p.washSaleSafe : undefined,
      daysSinceLastTrade: num(p?.daysSinceLastTrade),
    }))
    .filter((p) => p.symbol.length > 0);

  if (positions.length === 0) {
    return NextResponse.json(
      { error: 'Nothing to export — no harvester positions provided' },
      { status: 400 },
    );
  }

  const generatedAt = new Date();
  const environment =
    body?.environment === 'demo' || body?.environment === 'paper' || body?.environment === 'live'
      ? (body.environment as 'demo' | 'paper' | 'live')
      : null;

  const input: TaxHarvestPlanExportInput = {
    accountName: str(body?.accountName, 80) || 'Portfolio',
    broker: str(body?.broker, 60),
    environment,
    access: body?.access === 'read-only' ? 'read-only' : 'trading',
    isDemo: body?.isDemo === true,
    taxYear: num(body?.taxYear),
    estimatedTaxRate: num(body?.estimatedTaxRate),
    positions,
    generatedAt,
    note: str(body?.note, 500),
  };

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
