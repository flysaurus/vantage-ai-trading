// ─── Risk / Exposure Narrative — Compute & Trigger Layers ────
// Deterministic portfolio risk math. No AI calls here.
// Used by /api/risk-narrative and RiskNarrativeCard.

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RiskMetrics {
  sectorConcentration: { sector: string; pct: number }[];
  top3Concentration: { symbols: string[]; pct: number };
  top5Concentration: { symbols: string[]; pct: number };
  singlePositionRisk: { symbol: string; pct: number } | null;
  styleDrift: { sector: string; currentPct: number; targetPct: number; deviation: number }[];
  totalValue: number;
}

export interface RiskTrigger {
  type:
    | 'high_sector_concentration'
    | 'high_top_concentration'
    | 'single_position_risk'
    | 'style_drift';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metrics: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// SECTOR TARGETS PER INVESTOR STYLE
//
// Derived from ETF allocations in lib/investor-style-targets.ts,
// mapped to the GICS broad sector names used in lib/sectors.ts.
// Targets include a "Broad Market" and "Cash" bucket so the
// percentages sum to 100.  Broad Market / Cash / Fixed Income
// buckets are excluded from drift comparison since position
// sectors won't match them.
// ═══════════════════════════════════════════════════════════════

const STYLE_SECTOR_TARGETS: Record<string, Record<string, number>> = {
  buffett: {
    'Financial Services': 30,
    Consumer: 20,
    Healthcare: 15,
    Technology: 15,
    Industrials: 5,
    'Broad Market': 10,
    Cash: 5,
  },
  lynch: {
    Technology: 35,
    Consumer: 20,
    Healthcare: 15,
    'Financial Services': 10,
    Industrials: 5,
    'Broad Market': 10,
    Cash: 5,
  },
  livermore: {
    Technology: 45,
    Consumer: 20,
    'Financial Services': 10,
    'Media & Entertainment': 10,
    'Broad Market': 10,
    Cash: 5,
  },
  munger: {
    'Financial Services': 25,
    Consumer: 20,
    Healthcare: 15,
    Utilities: 10,
    'Broad Market': 25,
    Cash: 5,
  },
  soros: {
    'Broad Market': 35,
    'Fixed Income': 30,
    'International': 15,
    'Materials': 10,
    Cash: 10,
  },
};

/** Non-sector buckets that we skip during drift comparison. */
const NON_SECTOR_BUCKETS = new Set([
  'Broad Market',
  'Cash',
  'Fixed Income',
  'International',
]);

// ── Helpers ───────────────────────────────────────────────────

interface PositionInput {
  symbol: string;
  qty: number;
  currentPrice: number;
  sector?: string;
  avgCost: number;
}

/**
 * Compute sector concentrations from position array.
 * Groups by position.sector, falling back to "Other" when unknown.
 */
function computeSectorConcentration(
  positions: PositionInput[],
  totalValue: number,
): { sector: string; pct: number }[] {
  if (totalValue === 0) return [];

  const sectorMap = new Map<string, number>();

  for (const pos of positions) {
    const mv = pos.qty * pos.currentPrice;
    const sector = pos.sector || 'Other';
    sectorMap.set(sector, (sectorMap.get(sector) || 0) + mv);
  }

  return Array.from(sectorMap.entries())
    .map(([sector, value]) => ({
      sector,
      pct: Math.round((value / totalValue) * 1000) / 10, // 1 decimal
    }))
    .sort((a, b) => b.pct - a.pct);
}

// ═══════════════════════════════════════════════════════════════
// LAYER 4a — COMPUTE
// ═══════════════════════════════════════════════════════════════

export function computeRiskMetrics(
  positions: PositionInput[],
  investorStyle?: string,
): RiskMetrics {
  // ── Total portfolio value ──
  const totalValue = positions.reduce(
    (sum, p) => sum + p.qty * p.currentPrice,
    0,
  );

  // ── 1. Sector concentration ──
  const sectorConcentration = computeSectorConcentration(
    positions,
    totalValue,
  );

  // ── 2. Top-N concentration ──
  const sorted = [...positions]
    .map((p) => ({
      symbol: p.symbol,
      mv: p.qty * p.currentPrice,
    }))
    .sort((a, b) => b.mv - a.mv);

  const top3 = sorted.slice(0, 3);
  const top5 = sorted.slice(0, 5);

  const top3Pct = totalValue > 0
    ? Math.round((top3.reduce((s, p) => s + p.mv, 0) / totalValue) * 1000) / 10
    : 0;

  const top5Pct = totalValue > 0
    ? Math.round((top5.reduce((s, p) => s + p.mv, 0) / totalValue) * 1000) / 10
    : 0;

  // ── 3. Single-position risk ──
  let singlePositionRisk: { symbol: string; pct: number } | null = null;

  if (totalValue > 0 && sorted.length > 0) {
    const largest = sorted[0];
    const largestPct = Math.round((largest.mv / totalValue) * 1000) / 10;
    if (largestPct > 20) {
      singlePositionRisk = { symbol: largest.symbol, pct: largestPct };
    }
  }

  // ── 4. Style drift ──
  const styleDrift: {
    sector: string;
    currentPct: number;
    targetPct: number;
    deviation: number;
  }[] = [];

  if (investorStyle) {
    const targets = STYLE_SECTOR_TARGETS[investorStyle];
    if (targets) {
      const scMap = new Map(
        sectorConcentration.map((s) => [s.sector, s.pct]),
      );

      for (const [targetSector, targetPct] of Object.entries(targets)) {
        if (NON_SECTOR_BUCKETS.has(targetSector)) continue;

        const currentPct = scMap.get(targetSector) || 0;
        const deviation = Math.round((currentPct - targetPct) * 10) / 10;

        styleDrift.push({
          sector: targetSector,
          currentPct,
          targetPct,
          deviation,
        });
      }

      // Include any sectors the user has that the style doesn't target
      for (const sc of sectorConcentration) {
        if (NON_SECTOR_BUCKETS.has(sc.sector)) continue;
        if (targets[sc.sector] !== undefined) continue;

        styleDrift.push({
          sector: sc.sector,
          currentPct: sc.pct,
          targetPct: 0,
          deviation: sc.pct,
        });
      }

      // Sort by absolute deviation descending
      styleDrift.sort(
        (a, b) => Math.abs(b.deviation) - Math.abs(a.deviation),
      );
    }
  }

  return {
    sectorConcentration,
    top3Concentration: {
      symbols: top3.map((p) => p.symbol),
      pct: top3Pct,
    },
    top5Concentration: {
      symbols: top5.map((p) => p.symbol),
      pct: top5Pct,
    },
    singlePositionRisk,
    styleDrift,
    totalValue,
  };
}

// ═══════════════════════════════════════════════════════════════
// LAYER 4b — TRIGGER EVALUATION
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  sectorWarning: 35,
  sectorCritical: 50,
  top3Warning: 50,
  top3Critical: 70,
  singlePosWarning: 20,
  singlePosCritical: 35,
  driftWarning: 15,
  driftCritical: 25,
} as const;

export function evaluateRiskTriggers(
  metrics: RiskMetrics,
): RiskTrigger[] {
  const triggers: RiskTrigger[] = [];

  // ── Sector concentration ──
  for (const sc of metrics.sectorConcentration) {
    if (sc.pct > THRESHOLDS.sectorCritical) {
      triggers.push({
        type: 'high_sector_concentration',
        severity: 'critical',
        message: `${sc.sector} dominates your portfolio at ${sc.pct}% — dangerously concentrated.`,
        metrics: { sector: sc.sector, pct: sc.pct },
      });
    } else if (sc.pct > THRESHOLDS.sectorWarning) {
      triggers.push({
        type: 'high_sector_concentration',
        severity: 'warning',
        message: `${sc.sector} makes up ${sc.pct}% of your portfolio — consider diversifying.`,
        metrics: { sector: sc.sector, pct: sc.pct },
      });
    }
  }

  // ── Top-3 concentration ──
  if (metrics.top3Concentration.pct > THRESHOLDS.top3Critical) {
    triggers.push({
      type: 'high_top_concentration',
      severity: 'critical',
      message: `Your top 3 holdings (${metrics.top3Concentration.symbols.join(', ')}) represent ${metrics.top3Concentration.pct}% of your portfolio — heavy concentration risk.`,
      metrics: {
        symbols: metrics.top3Concentration.symbols,
        pct: metrics.top3Concentration.pct,
      },
    });
  } else if (metrics.top3Concentration.pct > THRESHOLDS.top3Warning) {
    triggers.push({
      type: 'high_top_concentration',
      severity: 'warning',
      message: `Your top 3 holdings (${metrics.top3Concentration.symbols.join(', ')}) make up ${metrics.top3Concentration.pct}% — somewhat concentrated.`,
      metrics: {
        symbols: metrics.top3Concentration.symbols,
        pct: metrics.top3Concentration.pct,
      },
    });
  }

  // ── Single position risk ──
  if (metrics.singlePositionRisk) {
    const { symbol, pct } = metrics.singlePositionRisk;
    if (pct > THRESHOLDS.singlePosCritical) {
      triggers.push({
        type: 'single_position_risk',
        severity: 'critical',
        message: `${symbol} alone is ${pct}% of your portfolio — one bad day could really hurt.`,
        metrics: { symbol, pct },
      });
    } else {
      triggers.push({
        type: 'single_position_risk',
        severity: 'warning',
        message: `${symbol} at ${pct}% is a large single-name bet.`,
        metrics: { symbol, pct },
      });
    }
  }

  // ── Style drift ──
  for (const drift of metrics.styleDrift) {
    const absDev = Math.abs(drift.deviation);
    if (absDev > THRESHOLDS.driftCritical) {
      const direction = drift.deviation > 0 ? 'Overweight' : 'Underweight';
      triggers.push({
        type: 'style_drift',
        severity: 'critical',
        message: `${direction} ${drift.sector} by ${absDev}% vs your style benchmark.`,
        metrics: {
          sector: drift.sector,
          currentPct: drift.currentPct,
          targetPct: drift.targetPct,
          deviation: drift.deviation,
        },
      });
    } else if (absDev > THRESHOLDS.driftWarning) {
      const direction = drift.deviation > 0 ? 'Overweight' : 'Underweight';
      triggers.push({
        type: 'style_drift',
        severity: 'warning',
        message: `${direction} ${drift.sector} by ${absDev}% vs your style benchmark.`,
        metrics: {
          sector: drift.sector,
          currentPct: drift.currentPct,
          targetPct: drift.targetPct,
          deviation: drift.deviation,
        },
      });
    }
  }

  return triggers;
}

// ── Severity helpers (for UI coloring) ────────────────────────

export type SeverityLevel = 'safe' | 'warning' | 'critical';

export function getOverallSeverity(triggers: RiskTrigger[]): SeverityLevel {
  if (triggers.length === 0) return 'safe';
  if (triggers.some((t) => t.severity === 'critical')) return 'critical';
  return 'warning';
}
