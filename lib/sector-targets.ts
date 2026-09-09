// ═══════════════════════════════════════════════════════════════
// Sector allocation targets + non-sector buckets.
//
// Shared by the Noticed drift engine (lib/noticed/engine.ts) and the
// sector-decomposition helpers (lib/etf-sectors.ts). Extracted from the
// retired lib/risk-narrative.ts so the single source of truth lives here.
// ═══════════════════════════════════════════════════════════════

export const STYLE_SECTOR_TARGETS: Record<string, Record<string, number>> = {
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
export const NON_SECTOR_BUCKETS = new Set([
  'Broad Market',
  'Cash',
  'Fixed Income',
  'International',
]);
