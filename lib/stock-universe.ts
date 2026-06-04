// ─── Stock Universe & Thematic Baskets ───────────────────────
// 150+ US stocks across 11 sectors, 8 thematic baskets,
// natural-language theme detection, and basket generation.
// Server-side only — scoreStock requires server context.

import { scoreStock, type StockScore } from '@/lib/stock-scorer';

// ─── Stock Universe ──────────────────────────────────────────

export const STOCK_UNIVERSE: Record<string, string[]> = {
  Technology: [
    'MSFT', 'AAPL', 'NVDA', 'GOOGL', 'META', 'AVGO',
    'ADBE', 'CRM', 'ORCL', 'CSCO', 'INTC', 'AMD', 'QCOM',
    'TXN', 'AMAT', 'LRCX', 'KLAC', 'MCHP', 'ADI',
    'SNPS', 'CDNS', 'DDOG', 'CRWD', 'NET', 'SNOW',
    'MDB', 'TEAM', 'WDAY', 'ZS', 'OKTA', 'HUBS',
    'GTLB', 'BILL', 'PAYC', 'PCTY', 'SMCI', 'MSTR',
    'PLTR', 'ARM', 'TSM', 'ASML', 'COIN', 'SOFI',
    'UPST', 'SQ', 'HOOD', 'RKLB', 'IONQ',
  ],
  Healthcare: [
    'JNJ', 'UNH', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT',
    'DHR', 'BMY', 'AMGN', 'LLY', 'MDT', 'SYK', 'BSX',
    'VRTX', 'REGN', 'BIIB', 'GILD', 'MRNA', 'BNTX',
    'INCY', 'EXEL', 'BMRN', 'ALNY', 'IONS', 'ISRG',
    'EW', 'HOLX', 'PODD', 'DXCM', 'CVS', 'CI',
    'HUM', 'CNC', 'MOH', 'ELV', 'ZBH', 'BAX', 'BDX',
  ],
  Financials: [
    'JPM', 'BAC', 'WFC', 'C', 'USB', 'PNC', 'TFC',
    'COF', 'GS', 'MS', 'BLK', 'SCHW', 'BRK.B', 'AXP',
    'V', 'MA', 'PYPL', 'FIS', 'FISV', 'GPN',
    'PGR', 'ALL', 'TRV', 'CB', 'MET', 'PRU',
    'AFL', 'GL', 'UNM', 'RJF', 'LPLA', 'IBKR',
  ],
  'Consumer Discretionary': [
    'AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX', 'TGT',
    'LOW', 'TJX', 'BKNG', 'MAR', 'HLT', 'YUM',
    'LULU', 'DECK', 'ONON', 'CROX', 'RH', 'WING',
    'DPZ', 'CMG', 'TXRH', 'ABNB', 'UBER', 'LYFT',
    'EXPE', 'RIVN', 'GM', 'F',
  ],
  'Consumer Staples': [
    'PG', 'KO', 'PEP', 'WMT', 'COST', 'PM', 'MO',
    'CL', 'KMB', 'GIS', 'K', 'CAG', 'SJM', 'HRL',
    'MNST', 'KDP', 'STZ', 'TAP', 'SFM', 'GO',
  ],
  Communications: [
    'META', 'GOOGL', 'NFLX', 'DIS', 'CMCSA', 'VZ', 'T',
    'TMUS', 'CHTR', 'WBD', 'PARA', 'SPOT', 'PINS',
    'SNAP', 'RDDT', 'TTWO', 'EA', 'RBLX', 'U',
  ],
  Industrials: [
    'GE', 'HON', 'UPS', 'BA', 'CAT', 'DE', 'LMT',
    'RTX', 'NOC', 'GD', 'MMM', 'EMR', 'ETN', 'PH',
    'ROK', 'AME', 'FAST', 'WM', 'RSG', 'XYL',
    'CARR', 'OTIS', 'TT', 'IR', 'GNRC', 'HUBB',
  ],
  Energy: [
    'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX',
    'VLO', 'PXD', 'DVN', 'HES', 'OXY', 'HAL', 'BKR',
    'FANG', 'CTRA', 'AR', 'EQT', 'LNG', 'KMI',
  ],
  'Real Estate': [
    'PLD', 'AMT', 'CCI', 'EQIX', 'PSA', 'DLR', 'O',
    'VICI', 'SPG', 'AVB', 'EQR', 'MAA', 'NNN',
    'STAG', 'REXR', 'EXR', 'CUBE', 'COLD', 'IIPR',
  ],
  Utilities: [
    'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'XEL',
    'ED', 'ETR', 'PPL', 'CMS', 'LNT', 'EVRG',
    'AES', 'NRG', 'VST', 'CEG',
  ],
  Materials: [
    'LIN', 'APD', 'ECL', 'SHW', 'FCX', 'NEM', 'NUE',
    'STLD', 'RS', 'ALB', 'CF', 'MOS', 'IFF', 'PPG',
  ],
};

// ─── Thematic Universe ───────────────────────────────────────

export interface ThemeDefinition {
  emoji: string;
  name: string;
  description: string;
  subThemes: Record<string, string[]>;
  styleFit: string[];
}

export const THEME_UNIVERSE: Record<string, ThemeDefinition> = {
  ai_infrastructure: {
    emoji: '🤖',
    name: 'AI Infrastructure',
    description: 'Full AI value chain from chips to applications',
    subThemes: {
      'Core AI': ['NVDA', 'AMD', 'GOOGL', 'META', 'MSFT'],
      Semiconductors: ['TSM', 'AVGO', 'ASML', 'AMAT', 'LRCX', 'KLAC', 'ARM'],
      'Data Centers': ['EQIX', 'DLR', 'SMCI'],
      'Cooling & Power': ['VRT', 'ETN', 'CARR', 'GNRC', 'VST'],
      'Software & Apps': ['PLTR', 'CRM', 'SNOW', 'MDB', 'DDOG'],
    },
    styleFit: ['lynch', 'livermore', 'soros'],
  },
  clean_energy: {
    emoji: '🌱',
    name: 'Clean Energy',
    description: 'Renewable energy and clean technology transition',
    subThemes: {
      Solar: ['ENPH', 'FSLR', 'SEDG'],
      'Wind & Utilities': ['NEE', 'AES', 'CEG'],
      'EV & Battery': ['TSLA', 'RIVN'],
      'Grid & Infrastructure': ['ETN', 'GNRC', 'PWR', 'CARR'],
    },
    styleFit: ['lynch', 'soros', 'buffett'],
  },
  cybersecurity: {
    emoji: '🔒',
    name: 'Cybersecurity',
    description: 'Digital security and threat protection',
    subThemes: {
      Endpoint: ['CRWD', 'PANW'],
      Network: ['ZS', 'FTNT', 'CHKP'],
      Identity: ['OKTA'],
      'Cloud Security': ['NET', 'DDOG'],
    },
    styleFit: ['lynch', 'livermore'],
  },
  healthcare_innovation: {
    emoji: '🏥',
    name: 'Healthcare Innovation',
    description: 'Next-generation healthcare and biotech',
    subThemes: {
      'GLP-1 & Obesity': ['LLY'],
      'Gene Therapy': ['VRTX', 'ALNY'],
      'Medical Devices': ['ISRG', 'EW', 'DXCM', 'PODD'],
      'Large Cap Pharma': ['JNJ', 'ABBV', 'MRK'],
      'Health Insurance': ['UNH', 'ELV', 'CI'],
    },
    styleFit: ['lynch', 'buffett', 'munger'],
  },
  dividend_aristocrats: {
    emoji: '💵',
    name: 'Dividend Aristocrats',
    description: 'Consistent dividend payers with strong moats',
    subThemes: {
      'Consumer Staples': ['PG', 'KO', 'PEP', 'CL'],
      Financials: ['JPM', 'V', 'MA', 'AXP'],
      Healthcare: ['JNJ', 'ABBV', 'MDT'],
      REITs: ['O', 'VICI', 'NNN'],
      Utilities: ['NEE', 'DUK', 'SO'],
    },
    styleFit: ['munger', 'buffett'],
  },
  reshoring: {
    emoji: '🏭',
    name: 'US Reshoring',
    description: 'US manufacturing and supply chain reshoring',
    subThemes: {
      Defense: ['LMT', 'RTX', 'NOC', 'GD', 'BA'],
      'Semiconductors US': ['INTC', 'TXN'],
      Infrastructure: ['CAT', 'DE', 'EMR', 'ETN'],
      'Steel & Materials': ['NUE', 'STLD', 'RS'],
    },
    styleFit: ['soros', 'buffett', 'lynch'],
  },
  fintech: {
    emoji: '💳',
    name: 'Fintech',
    description: 'Financial technology and digital payments',
    subThemes: {
      Payments: ['V', 'MA', 'PYPL', 'SQ', 'GPN'],
      'Digital Banking': ['SOFI', 'UPST'],
      'Crypto Adjacent': ['COIN', 'MSTR', 'HOOD'],
      'Wealth Tech': ['SCHW', 'IBKR', 'LPLA'],
    },
    styleFit: ['lynch', 'livermore', 'soros'],
  },
  consumer_comeback: {
    emoji: '🛒',
    name: 'Consumer Comeback',
    description: 'Consumer spending resilience and growth',
    subThemes: {
      'E-Commerce': ['AMZN', 'SHOP'],
      'Travel & Leisure': ['ABNB', 'BKNG', 'MAR', 'HLT'],
      'Premium & Luxury': ['LULU', 'RH', 'DECK', 'ONON'],
      Restaurants: ['MCD', 'CMG', 'SBUX', 'WING', 'DPZ'],
    },
    styleFit: ['lynch', 'buffett'],
  },
};

// ─── Natural Language Theme Detection ───────────────────────

export function detectTheme(message: string): string | null {
  const lower = message.toLowerCase();

  const themeKeywords: Record<string, string[]> = {
    ai_infrastructure: [
      'ai', 'artificial intelligence', 'semiconductor',
      'chip', 'data center', 'nvidia', 'gpu', 'llm',
      'machine learning', 'deep learning', 'cooling',
      'inference', 'training', 'foundry',
    ],
    clean_energy: [
      'clean energy', 'renewable', 'solar', 'wind',
      'ev', 'electric vehicle', 'battery', 'green',
      'climate', 'esg', 'sustainability', 'carbon',
    ],
    cybersecurity: [
      'cyber', 'security', 'hack', 'ransomware',
      'firewall', 'threat', 'zero trust', 'endpoint',
      'breach', 'protection', 'identity',
    ],
    healthcare_innovation: [
      'healthcare', 'biotech', 'pharma', 'drug',
      'glp-1', 'ozempic', 'wegovy', 'gene therapy',
      'medical device', 'longevity', 'aging', 'cancer',
    ],
    dividend_aristocrats: [
      'dividend', 'income', 'yield', 'aristocrat',
      'consistent', 'passive income', 'monthly income',
      'safe dividend', 'high yield',
    ],
    reshoring: [
      'reshoring', 'manufacturing', 'defense', 'military',
      'supply chain', 'onshoring', 'made in usa',
      'infrastructure', 'industrial', 'tariff',
    ],
    fintech: [
      'fintech', 'payment', 'digital bank', 'crypto',
      'blockchain', 'neobank', 'buy now pay later',
      'digital wallet', 'defi',
    ],
    consumer_comeback: [
      'consumer', 'retail', 'travel', 'luxury',
      'restaurant', 'spending', 'discretionary',
      'ecommerce', 'e-commerce', 'shopping',
    ],
  };

  for (const [theme, keywords] of Object.entries(themeKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return theme;
    }
  }

  return null;
}

// ─── Theme Basket Generation ─────────────────────────────────

export interface ScoredBasketStock extends StockScore {
  subTheme: string;
}

export interface ThemeBasketResult {
  themeKey: string;
  theme: ThemeDefinition;
  scoredStocks: ScoredBasketStock[];
  totalStocksScored: number;
}

export async function getThemeBasket(
  themeKey: string,
  investorStyle: string,
  riskTolerance: string,
  maxPerSubTheme: number = 2
): Promise<ThemeBasketResult> {
  const theme = THEME_UNIVERSE[themeKey];
  if (!theme) {
    throw new Error(`Unknown theme: ${themeKey}`);
  }

  const results: ScoredBasketStock[] = [];
  let totalScored = 0;

  // Score stocks per sub-theme sequentially
  // to avoid Finnhub rate limits
  for (const [subThemeName, symbols] of Object.entries(theme.subThemes)) {
    const scores = await Promise.all(
      symbols.map((sym) =>
        scoreStock(sym, investorStyle, riskTolerance)
      )
    );

    totalScored += symbols.length;

    const validScores = scores
      .filter((s): s is StockScore => s !== null)
      .map((s) => ({ ...s, subTheme: subThemeName }))
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, maxPerSubTheme);

    results.push(...validScores);
  }

  // Sort final basket by composite score
  const sortedResults = results.sort(
    (a, b) => b.compositeScore - a.compositeScore
  );

  return {
    themeKey,
    theme,
    scoredStocks: sortedResults,
    totalStocksScored: totalScored,
  };
}
