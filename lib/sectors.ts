// ─── Comprehensive Industry → Sector Mapping ──────────────────
// Maps Alpaca's industry field to broad GICS-like sectors.
// Source: GICS-based classification. Industry names from Alpaca asset data.

const INDUSTRY_TO_SECTOR: Record<string, string> = {
  // ── Financial Services ──
  'Asset Management': 'Financial Services',
  'Banks - Diversified': 'Financial Services',
  'Banks - Regional': 'Financial Services',
  'Capital Markets': 'Financial Services',
  'Credit Services': 'Financial Services',
  'Financial Conglomerates': 'Financial Services',
  'Financial Data & Stock Exchanges': 'Financial Services',
  'Insurance - Diversified': 'Financial Services',
  'Insurance - Life': 'Financial Services',
  'Insurance - Property & Casualty': 'Financial Services',
  'Insurance - Reinsurance': 'Financial Services',
  'Insurance - Specialty': 'Financial Services',
  'Insurance Brokers': 'Financial Services',
  'Mortgage Finance': 'Financial Services',
  'Shell Companies': 'Financial Services',
  'Financial Services': 'Financial Services',
  'Financial': 'Financial Services',

  // ── Technology ──
  'Software - Application': 'Technology',
  'Software - Infrastructure': 'Technology',
  'Information Technology Services': 'Technology',
  'Semiconductors': 'Technology',
  'Semiconductor Equipment & Materials': 'Technology',
  'Consumer Electronics': 'Technology',
  'Electronic Components': 'Technology',
  'Communication Equipment': 'Technology',
  'Computer Hardware': 'Technology',
  'Solar': 'Technology',
  'Scientific & Technical Instruments': 'Technology',
  'Technology': 'Technology',

  // ── Healthcare ──
  'Biotechnology': 'Healthcare',
  'Drug Manufacturers - General': 'Healthcare',
  'Drug Manufacturers - Specialty & Generic': 'Healthcare',
  'Medical Devices': 'Healthcare',
  'Medical Instruments & Supplies': 'Healthcare',
  'Medical Care Facilities': 'Healthcare',
  'Medical Distribution': 'Healthcare',
  'Health Information Services': 'Healthcare',
  'Diagnostics & Research': 'Healthcare',
  'Healthcare Plans': 'Healthcare',
  'Pharmaceutical Retailers': 'Healthcare',
  'Healthcare': 'Healthcare',

  // ── Consumer ──
  'Internet Retail': 'Consumer',
  'Specialty Retail': 'Consumer',
  'Department Stores': 'Consumer',
  'Home Improvement Retail': 'Consumer',
  'Discount Stores': 'Consumer',
  'Apparel Retail': 'Consumer',
  'Apparel Manufacturing': 'Consumer',
  'Footwear & Accessories': 'Consumer',
  'Luxury Goods': 'Consumer',
  'Restaurants': 'Consumer',
  'Beverages - Non-Alcoholic': 'Consumer',
  'Beverages - Alcoholic': 'Consumer',
  'Beverages - Brewers': 'Consumer',
  'Beverages - Wineries & Distilleries': 'Consumer',
  'Packaged Foods': 'Consumer',
  'Confectioners': 'Consumer',
  'Farm Products': 'Consumer',
  'Household & Personal Products': 'Consumer',
  'Personal Services': 'Consumer',
  'Education & Training Services': 'Consumer',
  'Gambling': 'Consumer',
  'Leisure': 'Consumer',
  'Lodging': 'Consumer',
  'Resorts & Casinos': 'Consumer',
  'Travel Services': 'Consumer',
  'Auto & Truck Dealerships': 'Consumer',
  'Recreational Vehicles': 'Consumer',
  'Consumer': 'Consumer',
  'Consumer Goods': 'Consumer',

  // ── Media & Entertainment ──
  'Entertainment': 'Media & Entertainment',
  'Internet Content & Information': 'Media & Entertainment',
  'Electronic Gaming & Multimedia': 'Media & Entertainment',
  'Advertising Agencies': 'Media & Entertainment',
  'Publishing': 'Media & Entertainment',
  'Broadcasting': 'Media & Entertainment',
  'Telecom Services': 'Media & Entertainment',
  'Media & Entertainment': 'Media & Entertainment',

  // ── Industrials ──
  'Aerospace & Defense': 'Industrials',
  'Airlines': 'Industrials',
  'Airports & Air Services': 'Industrials',
  'Building Products & Equipment': 'Industrials',
  'Construction': 'Industrials',
  'Engineering & Construction': 'Industrials',
  'Farm & Heavy Construction Machinery': 'Industrials',
  'Industrial Distribution': 'Industrials',
  'Integrated Freight & Logistics': 'Industrials',
  'Railroads': 'Industrials',
  'Trucking': 'Industrials',
  'Marine Shipping': 'Industrials',
  'Rental & Leasing Services': 'Industrials',
  'Conglomerates': 'Industrials',
  'Electrical Equipment & Parts': 'Industrials',
  'Specialty Industrial Machinery': 'Industrials',
  'Metal Fabrication': 'Industrials',
  'Pollution & Treatment Controls': 'Industrials',
  'Security & Protection Services': 'Industrials',
  'Staffing & Employment Services': 'Industrials',
  'Waste Management': 'Industrials',
  'Business Equipment & Supplies': 'Industrials',
  'Industrials': 'Industrials',

  // ── Energy ──
  'Oil & Gas E&P': 'Energy',
  'Oil & Gas Integrated': 'Energy',
  'Oil & Gas Midstream': 'Energy',
  'Oil & Gas Refining & Marketing': 'Energy',
  'Oil & Gas Equipment & Services': 'Energy',
  'Oil & Gas Drilling': 'Energy',
  'Thermal Coal': 'Energy',
  'Uranium': 'Energy',
  'Energy': 'Energy',

  // ── Utilities ──
  'Utilities - Regulated Electric': 'Utilities',
  'Utilities - Regulated Gas': 'Utilities',
  'Utilities - Regulated Water': 'Utilities',
  'Utilities - Diversified': 'Utilities',
  'Utilities - Renewable': 'Utilities',
  'Utilities - Independent Power Producers': 'Utilities',
  'Utilities': 'Utilities',

  // ── Real Estate ──
  'REIT - Diversified': 'Real Estate',
  'REIT - Healthcare Facilities': 'Real Estate',
  'REIT - Hotel & Motel': 'Real Estate',
  'REIT - Industrial': 'Real Estate',
  'REIT - Mortgage': 'Real Estate',
  'REIT - Office': 'Real Estate',
  'REIT - Residential': 'Real Estate',
  'REIT - Retail': 'Real Estate',
  'REIT - Specialty': 'Real Estate',
  'Real Estate - Development': 'Real Estate',
  'Real Estate - Diversified': 'Real Estate',
  'Real Estate Services': 'Real Estate',
  'Real Estate': 'Real Estate',

  // ── Materials ──
  'Chemicals': 'Materials',
  'Chemicals - Specialty': 'Materials',
  'Gold': 'Materials',
  'Silver': 'Materials',
  'Copper': 'Materials',
  'Aluminum': 'Materials',
  'Steel': 'Materials',
  'Other Industrial Metals & Mining': 'Materials',
  'Other Precious Metals & Mining': 'Materials',
  'Building Materials': 'Materials',
  'Lumber & Wood Production': 'Materials',
  'Paper & Paper Products': 'Materials',
  'Materials': 'Materials',

  // ── Automotive ──
  'Auto Manufacturers': 'Automotive',
  'Auto Parts': 'Automotive',
  'Automotive': 'Automotive',
};

export function industryToSector(industry: string): string | null {
  // Direct match
  if (INDUSTRY_TO_SECTOR[industry]) {
    return INDUSTRY_TO_SECTOR[industry];
  }

  // Case-insensitive match
  for (const [key, sector] of Object.entries(INDUSTRY_TO_SECTOR)) {
    if (key.toLowerCase() === industry.toLowerCase() || sector.toLowerCase() === industry.toLowerCase()) {
      return sector;
    }
  }

  return null; // unknown
}

export const SECTORS = [...new Set(Object.values(INDUSTRY_TO_SECTOR))] as const;
