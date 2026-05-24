// ─── Finnhub API Client ───────────────────────────────────────
// Wraps Finnhub.io REST API calls (free tier: 60 req/min).
// API key from FINNHUB_IO_API_KEY env var.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getToken(): string {
  const key = process.env.FINNHUB_IO_API_KEY;
  if (!key) throw new Error('FINNHUB_IO_API_KEY not configured');
  return key;
}

export interface FinnhubProfile {
  ticker: string;
  name: string;
  finnhubIndustry: string;
  marketCapitalization: number | null;
  exchange: string;
  logo: string;
  country: string;
  currency: string;
  ipo: string;
  phone: string;
  weburl: string;
  shareOutstanding: number | null;
}

/**
 * Fetch company profile from Finnhub.
 * Free tier: 60 calls/min. Returns null on error/not found.
 */
export async function getCompanyProfile(symbol: string): Promise<FinnhubProfile | null> {
  const token = getToken();
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol.toUpperCase())}&token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Finnhub returns empty object or no ticker on unknown symbols
    if (!data || !data.ticker) return null;
    return {
      ticker: data.ticker,
      name: data.name || '',
      finnhubIndustry: data.finnhubIndustry || '',
      marketCapitalization: data.marketCapitalization != null ? data.marketCapitalization * 1e6 : null,
      exchange: data.exchange || '',
      logo: data.logo || '',
      country: data.country || '',
      currency: data.currency || '',
      ipo: data.ipo || '',
      phone: data.phone || '',
      weburl: data.weburl || '',
      shareOutstanding: data.shareOutstanding != null ? data.shareOutstanding * 1e6 : null,
    };
  } catch {
    return null;
  }
}

/**
 * Map Finnhub's finnhubIndustry string to our 12-sector classification.
 * Finnhub uses GICS-based industry names.
 */
export function finnhubIndustryToSector(finnhubIndustry: string): string | null {
  // Normalize
  const fi = finnhubIndustry.trim();

  // ETF detection
  if (fi === 'N/A' || fi === 'ETF' || fi === '' || fi.toLowerCase().includes('exchange traded')) return 'ETF';

  // Direct GICS sector matches
  if (fi === 'Technology' || fi.includes('Software') || fi.includes('Semiconductor') || fi.includes('IT Services')) return 'Technology';
  if (fi === 'Financial Services' || fi.includes('Bank') || fi.includes('Insurance') || fi.includes('Capital Markets') || fi.includes('Mortgage')) return 'Financial Services';
  if (fi === 'Healthcare' || fi.includes('Biotech') || fi.includes('Pharma') || fi.includes('Medical') || fi.includes('Drug')) return 'Healthcare';
  if (fi === 'Consumer Cyclical' || fi.includes('Retail') || fi.includes('Auto') || fi.includes('Restaurant') || fi.includes('Leisure') || fi.includes('Apparel') || fi.includes('Lodging')) return 'Consumer';
  if (fi === 'Consumer Defensive' || fi.includes('Beverage') || fi.includes('Food') || fi.includes('Tobacco') || fi.includes('Household')) return 'Consumer';
  if (fi === 'Industrials' || fi.includes('Industrial') || fi.includes('Aerospace') || fi.includes('Rail') || fi.includes('Machinery') || fi.includes('Construction') || fi.includes('Logistics') || fi.includes('Freight')) return 'Industrials';
  if (fi === 'Energy' || fi.includes('Oil') || fi.includes('Gas') || fi.includes('Coal')) return 'Energy';
  if (fi === 'Utilities' || fi.includes('Water') || fi.includes('Power')) return 'Utilities';
  if (fi === 'Real Estate' || fi.includes('REIT') || fi.includes('Realty')) return 'Real Estate';
  if (fi === 'Basic Materials' || fi.includes('Chemical') || fi.includes('Metal') || fi.includes('Mining') || fi.includes('Steel') || fi.includes('Gold') || fi.includes('Copper') || fi.includes('Lumber')) return 'Materials';
  if (fi === 'Communication Services' || fi.includes('Telecom') || fi.includes('Media') || fi.includes('Entertainment') || fi.includes('Publishing') || fi.includes('Advertising')) return 'Media & Entertainment';

  return null;
}
