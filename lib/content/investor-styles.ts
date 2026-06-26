// ─── Unified Investor Style Content ─────────────────────────
// Single source of truth for all investor style metadata.
// Used by quiz-logic, PlayerStatusBar, ResultScreen, PortfolioDashboard,
// StockRecommendationCard, and onboarding/styles.

export const INVESTOR_STYLES = {
  buffett: {
    id: 'buffett' as const,
    emoji: '🏛️',
    fullHeadline: 'The Patient Builder',
    shortLabel: 'Patient Builder',
    tag: 'Buffett-style',
    description: "You play the long game. You'd rather own something great for ten years than chase something hot for ten days.",
  },
  lynch: {
    id: 'lynch' as const,
    emoji: '🔍',
    fullHeadline: 'The Growth Spotter',
    shortLabel: 'Growth Spotter',
    tag: 'Lynch-style',
    description: "You catch things early. You're drawn to businesses that are quietly getting bigger before anyone else notices.",
  },
  livermore: {
    id: 'livermore' as const,
    emoji: '📈',
    fullHeadline: 'The Momentum Reader',
    shortLabel: 'Momentum Reader',
    tag: 'Livermore-style',
    description: "You trust what's actually happening right now. Price and timing tell you more than a good story does.",
  },
  munger: {
    id: 'munger' as const,
    emoji: '🧠',
    fullHeadline: 'The Rational Thinker',
    shortLabel: 'Rational Thinker',
    tag: 'Munger-style',
    description: "You think before you act. Good business, good people, good incentives — if it doesn't add up, you walk away.",
  },
  soros: {
    id: 'soros' as const,
    emoji: '🌐',
    fullHeadline: 'The Contrarian',
    shortLabel: 'Contrarian',
    tag: 'Soros-style',
    description: "You look where others aren't looking. The crowd being wrong is often exactly where the opportunity is.",
  },
} as const;

export type InvestorStyleKey = keyof typeof INVESTOR_STYLES;

export const ALL_STYLE_KEYS = Object.keys(INVESTOR_STYLES) as InvestorStyleKey[];

// Pill traits (shortened for override pills)
export const PILL_TRAITS: Record<InvestorStyleKey, string> = {
  buffett: 'Patient',
  lynch: 'Growth',
  livermore: 'Momentum',
  munger: 'Rational',
  soros: 'Contrarian',
};

// Helper: get full content for a style
export function getStyleContent(style: string) {
  return INVESTOR_STYLES[style as InvestorStyleKey] || INVESTOR_STYLES.buffett;
}

// Helper: get style trait (for typewriter headline)
export function getStyleTrait(style: string): string {
  return INVESTOR_STYLES[style as InvestorStyleKey]?.fullHeadline || 'The Patient Builder';
}

// Helper: get style tag
export function getStyleTag(style: string): string {
  return INVESTOR_STYLES[style as InvestorStyleKey]?.tag || 'Buffett-style';
}

// Helper: get style emoji
export function getStyleEmoji(style: string): string {
  return INVESTOR_STYLES[style as InvestorStyleKey]?.emoji || '🏛️';
}

// Helper: get style description
export function getStyleDescription(style: string): string {
  return INVESTOR_STYLES[style as InvestorStyleKey]?.description || INVESTOR_STYLES.buffett.description;
}

// All styles as array (for pills, pickers)
export const ALL_STYLES = ALL_STYLE_KEYS.map(key => ({
  id: key,
  emoji: INVESTOR_STYLES[key].emoji,
  shortLabel: INVESTOR_STYLES[key].shortLabel,
  tag: INVESTOR_STYLES[key].tag,
  fullHeadline: INVESTOR_STYLES[key].fullHeadline,
}));
