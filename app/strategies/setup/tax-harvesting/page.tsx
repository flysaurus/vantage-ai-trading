'use client';

import { apiGet, apiPost } from '@/lib/api-client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingDown, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Activity, Info, Download } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { getDemoAccount } from '@/lib/demo-data';
import { returnToApp } from '@/lib/nav-back';
import { AccountProvider } from '@/context/AccountContext';
import TradeTicket from '@/components/portfolio/TradeTicket';
import TaxHarvestDisclosureGate from '@/components/disclosure/TaxHarvestDisclosureGate';
import {
  TLH_DISCLOSURE_BANNER_TEXT,
  isDisclosureAccepted,
  acceptDisclosure,
} from '@/lib/tax-harvest/disclosure';
import {
  parseTlhOrigin,
  setTlhCancelNotice,
  tlhOriginPath,
  type TlhOrigin,
} from '@/lib/tax-harvest/origin';
import {
  computePositionHoldingPeriod,
  summarizeTaxEstimate,
  annualSavingsRange,
  rateBreakdownNote,
  illustrativeEstimate,
  illustrativeNote,
  toFifoLots,
  SHORT_TERM_ASSUMED_RATE,
  LONG_TERM_ASSUMED_RATE,
  ILLUSTRATIVE_LOW_RATE,
  ILLUSTRATIVE_HIGH_RATE,
  ILLUSTRATIVE_LABEL,
  type PositionHoldingPerformance,
  type TaxLot,
} from '@/lib/tax-harvest/holding-period';

// ─── Types ─────────────────────────────────────────────────
interface Position {
  symbol: string;
  name?: string;
  qty: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPLPct: number;
  sector?: string;
}

interface HarvestSelection {
  symbol: string;
  qty: number;
  costBasis: number;
  currentPrice: number;
  loss: number;
  lossPct: number;
  estTaxSavings: number;
  replacement?: { symbol: string; name: string; price: number };
}

interface WashSaleStatus {
  symbol: string;
  isSafe: boolean;
  /** null when we hold no trade history for the account — unknown, not "clear". */
  daysSinceLastTrade: number | null;
  lastTradeDate: string | null;
  /** false ⇒ this account has no order history, so the check couldn't run. */
  historyAvailable?: boolean;
}

interface TradeSummary {
  realizedGains: number;
  realizedLosses: number;
  netPosition: number;
}

// ─── Broker position → harvestable position ────────────────
// The app's canonical position shape is { qty, avgCost, marketValue, totalPnl,
// totalPnlPercent } (types/index.ts). Reading broker-native field names
// (`avg_entry_price`, `cost_basis`) returned undefined for every live position,
// so costBasis became 0 and `unrealizedPL` became the FULL market value — every
// position looked like a huge gain and the page reported "No harvestable
// losses" while Holdings was showing real losses. Prefer the canonical numbers,
// then derive from avgCost, and only then fall back to a quote-relative cost.
function toHarvestPosition(
  p: any,
  price: number,
  opts?: { fallbackCostRatio?: number; sector?: string },
): Position {
  const qty = Number(p?.qty) || Number(p?.units) || 0;
  const livePrice = price > 0 ? price : Number(p?.currentPrice) || Number(p?.price) || 0;
  const marketValue = Number(p?.marketValue) > 0 ? Number(p.marketValue) : livePrice * qty;
  // Accept both the canonical store shape (avgCost / totalCost) and the raw
  // broker shape (/api/broker/snaptrade/positions → costBasis, no per-unit cost).
  const avgCost = Number(p?.avgCost) > 0
    ? Number(p.avgCost)
    : Number(p?.costBasis) > 0 && qty > 0
      ? Number(p.costBasis) / qty
      : NaN;
  const costBasis = Number(p?.totalCost) > 0
    ? Number(p.totalCost)
    : Number(p?.costBasis) > 0
      ? Number(p.costBasis)
      : avgCost > 0
        ? avgCost * qty
        : (qty > 0 && opts?.fallbackCostRatio ? livePrice * opts.fallbackCostRatio * qty : 0);
  // Canonical P&L is totalPnl; the broker route exposes it as openPnl.
  const totalPnl = Number(p?.totalPnl ?? p?.openPnl);
  const pnlPct = Number(p?.totalPnlPercent);
  const unrealizedPL = Number.isFinite(totalPnl) ? totalPnl : marketValue - costBasis;
  const unrealizedPLPct = Number.isFinite(pnlPct)
    ? pnlPct
    : costBasis > 0
      ? ((marketValue - costBasis) / costBasis) * 100
      : 0;
  return {
    symbol: p.symbol,
    name: p.name || p.symbol,
    qty,
    costBasis,
    currentPrice: livePrice,
    marketValue,
    unrealizedPL,
    unrealizedPLPct,
    sector: p.sector || opts?.sector || getSectorForSymbol(p.symbol),
  };
}

// ─── Replacement Security Mappings ─────────────────────────
const SECTOR_ETF_MAP: Record<string, Array<{ symbol: string; name: string }>> = {
  technology: [
    { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
    { symbol: 'XLK', name: 'Technology Select Sector SPDR' },
  ],
  financial: [
    { symbol: 'XLF', name: 'Financial Select Sector SPDR' },
    { symbol: 'VFH', name: 'Vanguard Financials ETF' },
  ],
  healthcare: [
    { symbol: 'XLV', name: 'Health Care Select Sector SPDR' },
    { symbol: 'VHT', name: 'Vanguard Health Care ETF' },
  ],
  energy: [
    { symbol: 'XLE', name: 'Energy Select Sector SPDR' },
    { symbol: 'VDE', name: 'Vanguard Energy ETF' },
  ],
  'consumer cyclical': [
    { symbol: 'XLY', name: 'Consumer Discretionary SPDR' },
    { symbol: 'VCR', name: 'Vanguard Consumer Disc. ETF' },
  ],
  'consumer defensive': [
    { symbol: 'XLP', name: 'Consumer Staples SPDR' },
    { symbol: 'VDC', name: 'Vanguard Consumer Staples ETF' },
  ],
  industrials: [
    { symbol: 'XLI', name: 'Industrial Select Sector SPDR' },
    { symbol: 'VIS', name: 'Vanguard Industrials ETF' },
  ],
  utilities: [
    { symbol: 'XLU', name: 'Utilities Select Sector SPDR' },
    { symbol: 'VPU', name: 'Vanguard Utilities ETF' },
  ],
  'real estate': [
    { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR' },
    { symbol: 'VNQ', name: 'Vanguard Real Estate ETF' },
  ],
  'communication services': [
    { symbol: 'XLC', name: 'Communication Services SPDR' },
    { symbol: 'VOX', name: 'Vanguard Communication Svcs ETF' },
  ],
  'basic materials': [
    { symbol: 'XLB', name: 'Materials Select Sector SPDR' },
    { symbol: 'VAW', name: 'Vanguard Materials ETF' },
  ],
};

const BROAD_MARKET = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF' },
];

function getReplacementSuggestions(sector?: string): Array<{ symbol: string; name: string }> {
  const key = (sector || '').toLowerCase();
  const sectorEtfs = SECTOR_ETF_MAP[key];
  if (sectorEtfs && sectorEtfs.length > 0) return sectorEtfs;
  return BROAD_MARKET;
}

// ─── Helpers ───────────────────────────────────────────────
function getCurrentYear(): number {
  return new Date().getFullYear();
}

function isYearEnd(): boolean {
  const month = new Date().getMonth(); // 0-indexed
  return month >= 9; // October (9) through December (11)
}

// ─── Page Component ────────────────────────────────────────
// Standalone /strategies route: mount AccountProvider so TradeTicket (the real
// pre-filled sell ticket) sees the active account and its trading capability,
// exactly as the shared Portfolio surfaces do.
export default function TaxHarvestingPage() {
  return (
    <AccountProvider>
      <TaxHarvestingPageInner />
    </AccountProvider>
  );
}

function TaxHarvestingPageInner() {
  const router = useRouter();
  const { user } = useAuth();
  const investorStyle = (user?.investorStyle || 'buffett') as import('@/types').InvestorStyle;
  const currentYear = getCurrentYear();
  const showUrgency = isYearEnd();

  // Data state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [tradeSummary, setTradeSummary] = useState<TradeSummary>({ realizedGains: 0, realizedLosses: 0, netPosition: 0 });
  const [isConnected, setIsConnected] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);

  // UI state
  const [selectedHarvests, setSelectedHarvests] = useState<Record<string, HarvestSelection>>({});
  const [selectedReplacements, setSelectedReplacements] = useState<Record<string, { symbol: string; name: string; price: number }>>({});
  const [washSaleStatuses, setWashSaleStatuses] = useState<Record<string, WashSaleStatus>>({});
  const [showWashRule, setShowWashRule] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [downloading, setDownloading] = useState(false);

  // ── Disclosure / navigation state (Round 25) ──
  // `accountKey` scopes the disclosure acceptance to ONE account; `origin` is
  // the screen the user actually came from (passed as real navigation state on
  // the entry links), so Cancel/Back return there instead of guessing.
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [accountBroker, setAccountBroker] = useState<string | null>(null);
  const [accountEnvironment, setAccountEnvironment] = useState<'demo' | 'paper' | 'live' | null>(null);
  const [origin, setOrigin] = useState<TlhOrigin | null>(null);
  const [showGate, setShowGate] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);

  // ── Holding-period + YTD data ──
  const [lotsBySymbol, setLotsBySymbol] = useState<Record<string, TaxLot[]>>({});
  const [ytdQuotes, setYtdQuotes] = useState<Record<string, { yearStartClose: number; latestClose: number }>>({});
  const [ytdLoading, setYtdLoading] = useState(false);

  // ── Real sell ticket (tradeable accounts only) ──
  const [harvestTicket, setHarvestTicket] = useState<{ symbol: string; price: number } | null>(null);

  // ─── Data Loading ────────────────────────────────────────
  // /strategies/* routes are standalone (NOT wrapped in BrokerProvider), so the
  // shared portfolio store is never populated here — reading it yielded an empty
  // positions list and reported "No harvestable losses" even when the account
  // held real losses (e.g. CHWY). Fetch positions directly, exactly like the
  // sibling DCA setup page, and never fall back to demo holdings while connected.
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setLoadError('');

        // Resolve the active live account so we scope broker calls to it.
        let connectionId: string | null = null;
        let liveTradingEnabled = true;
        let resolvedAccountKey = 'demo';
        let resolvedAccountLabel: string | null = null;
        let resolvedBroker: string | null = null;
        let resolvedEnvironment: 'demo' | 'paper' | 'live' | null = null;
        try {
          const acctRes = await apiGet('/api/accounts');
          if (acctRes.ok) {
            const data = await acctRes.json();
            const accounts = (data as any)?.accounts;
            const stored = typeof window !== 'undefined' ? localStorage.getItem('vantage:activeAccount') : null;
            const live = Array.isArray(accounts)
              ? (accounts.find((a: any) => a && a.id === stored && !a.isDemo)
                  || accounts.find((a: any) => a && !a.isDemo))
              : null;
            if (live) {
              liveTradingEnabled = live.tradingEnabled !== false;
              resolvedAccountKey = typeof live.id === 'string' ? live.id : 'demo';
              resolvedAccountLabel = live.name || live.broker || null;
              resolvedBroker = live.broker || live.brokerageSlug || null;
              resolvedEnvironment = (live.environment === 'paper' || live.environment === 'live')
                ? live.environment
                : 'live';
              if (typeof live.id === 'string' && live.id.startsWith('snaptrade:')) {
                connectionId = live.id.slice('snaptrade:'.length);
              }
            }
          }
        } catch { /* fall through to demo */ }

        if (cancelled) return;
        setAccountKey(resolvedAccountKey);
        setAccountLabel(resolvedAccountLabel);
        setAccountBroker(resolvedBroker);
        setAccountEnvironment(resolvedEnvironment ?? (resolvedAccountKey === 'demo' ? 'demo' : null));

        // Check broker status (scoped to the resolved connection when we have one).
        let connected = false;
        let readOnly = false;
        try {
          const statusUrl = connectionId
            ? `/api/broker/status?connectionId=${encodeURIComponent(connectionId)}`
            : '/api/broker/status';
          const statusRes = await apiGet(statusUrl);
          if (statusRes.ok) {
            const status = await statusRes.json();
            connected = status.connected || status.isConnected || false;
            // Read-only (view-only) connections are connected but can't trade.
            readOnly = connected && (status.trading_enabled === false || !liveTradingEnabled);
          }
        } catch { /* use demo fallback */ }

        if (cancelled) return;
        setIsConnected(connected);
        setIsDemo(!connected);
        setIsReadOnly(readOnly);

        // Load positions
        let posList: Position[] = [];
        let prices: Record<string, { price: number; changePct: number; name?: string }> = {};

        if (connected) {
          // Fetch real broker positions directly (the account call the store
          // would have used is unavailable on standalone strategy routes).
          let rawPositions: any[] = [];
          try {
            const posUrl = connectionId
              ? `/api/broker/snaptrade/positions?connectionId=${encodeURIComponent(connectionId)}`
              : '/api/broker/snaptrade/positions';
            const posRes = await apiGet(posUrl);
            if (posRes.ok) {
              const data: unknown = await posRes.json();
              rawPositions = Array.isArray(data)
                ? (data as any[])
                : Array.isArray((data as any)?.positions)
                  ? (data as any).positions
                  : [];
            }
          } catch { /* continue with whatever we have */ }

          if (cancelled) return;

          if (rawPositions.length > 0) {
            const symbols = rawPositions.map((p: any) => p.symbol).filter(Boolean);
            // Fetch live prices
            try {
              const qRes = await apiPost('/api/market/quotes', { symbols });
              if (qRes.ok) {
                const qData = await qRes.json();
                Object.entries(qData.quotes || qData || {}).forEach(([sym, q]: [string, any]) => {
                  prices[sym] = { price: q.price ?? q.c ?? 0, changePct: q.changePercent ?? q.dp ?? 0 };
                });
              }
            } catch { /* continue */ }

            posList = rawPositions.map((p: any) =>
              toHarvestPosition(p, prices[p.symbol]?.price ?? 0),
            );
          }
        } else {
          // Demo data
          const demoAccount = getDemoAccount(investorStyle, {});
          if (demoAccount?.positions?.length) {
            const symbols = demoAccount.positions.map((p: any) => p.symbol);
            try {
              const qRes = await await apiPost('/api/market/quotes', { symbols });
              if (qRes.ok) {
                const qData = await qRes.json();
                Object.entries(qData.quotes || qData || {}).forEach(([sym, q]: [string, any]) => {
                  prices[sym] = { price: q.price ?? q.c ?? 0, changePct: q.changePercent ?? q.dp ?? 0 };
                });
              }
            } catch { /* continue */ }

            posList = demoAccount.positions.map((p: any) =>
              toHarvestPosition(p, prices[p.symbol]?.price ?? 0, { fallbackCostRatio: 0.9 }),
            );
          }
        }

        if (cancelled) return;
        setPositions(posList);

        // ── Holding-period ledger: the FIFO lots behind each position ──
        // ONE source of truth, shared with the wash-sale window below: the
        // account-scoped purchase-dates endpoint (FIFO `position_lots`, falling
        // back to raw buy `orders`). Reading either table directly from here is
        // what let the two panels disagree — the wash-sale check used to read
        // every account's orders while this list only read the active one.
        // Zero lots for imported broker positions is expected — those carry no
        // acquisition date, and the page prices them with a labelled illustrative
        // range rather than silently reporting $0.00.
        try {
          const scope = connectionId
            ? `connectionId=${encodeURIComponent(connectionId)}`
            : 'demo=1';
          const lotsRes = await fetch(`/api/strategies/tax-harvest/purchase-dates?${scope}`);
          if (lotsRes.ok) {
            const lotData = await lotsRes.json();
            const rowsByTicker = (lotData?.lotsByTicker || {}) as Record<string, any[]>;
            const grouped: Record<string, TaxLot[]> = {};
            for (const [ticker, rows] of Object.entries(rowsByTicker)) {
              const sym = String(ticker || '').toUpperCase();
              if (!sym || !Array.isArray(rows)) continue;
              grouped[sym] = rows.map((row: any) => ({
                id: String(row?.id ?? ''),
                qty: Number(row?.qty) || 0,
                remainingQty: Number(row?.remainingQty) || 0,
                priceAtFill: Number(row?.priceAtFill) || 0,
                filledAt: String(row?.filledAt || ''),
              }));
            }
            if (!cancelled) setLotsBySymbol(grouped);
          }
        } catch { /* no purchase-date ledger available — every position reports unknown */ }

        // ── YTD baseline closes (prior-year close per symbol) ──
        if (posList.length > 0 && !cancelled) {
          setYtdLoading(true);
          try {
            const ytdRes = await apiGet(`/api/market/ytd?symbols=${posList.map(p => p.symbol).join(',')}`);
            if (ytdRes.ok) {
              const ytdData = await ytdRes.json();
              const rows = ytdData?.quotes || {};
              const parsed: Record<string, { yearStartClose: number; latestClose: number }> = {};
              Object.entries(rows).forEach(([sym, r]: [string, any]) => {
                const yearStartClose = Number(r?.yearStartClose);
                const latestClose = Number(r?.latestClose);
                if (Number.isFinite(yearStartClose) && yearStartClose > 0) {
                  parsed[sym] = { yearStartClose, latestClose: Number.isFinite(latestClose) ? latestClose : 0 };
                }
              });
              if (!cancelled) setYtdQuotes(parsed);
            }
          } catch { /* YTD row simply won't render */ }
          if (!cancelled) setYtdLoading(false);
        }

        // Load YTD trade summary
        const summary = await loadTradeSummary(connected);
        if (!cancelled) setTradeSummary(summary);

        // Load wash sale statuses for loss positions
        const lossSymbols = posList.filter(p => p.unrealizedPL < 0).map(p => p.symbol);
        if (lossSymbols.length > 0) {
          const statuses: Record<string, WashSaleStatus> = {};
          await Promise.all(lossSymbols.map(async (sym) => {
            try {
              const washScope = connectionId
                ? `&connectionId=${encodeURIComponent(connectionId)}`
                : '&demo=1';
              const res = await fetch(`/api/strategies/tax-harvest/wash-sale-check?symbol=${sym}${washScope}`);
              if (res.ok) statuses[sym] = await res.json();
              else statuses[sym] = { symbol: sym, isSafe: true, daysSinceLastTrade: null, lastTradeDate: null, historyAvailable: undefined };
            } catch {
              statuses[sym] = { symbol: sym, isSafe: true, daysSinceLastTrade: null, lastTradeDate: null, historyAvailable: undefined };
            }
          }));
          if (!cancelled) setWashSaleStatuses(statuses);
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  // ─── Toast auto-dismiss ──────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Entry origin (real navigation state, not a guess) ────
  // Entry links pass ?from=<origin>; Cancel/Back return there.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setOrigin(parseTlhOrigin(params.get('from')));
  }, []);

  // ─── Disclosure gate ─────────────────────────────────────
  // Blocking, per account. Re-shown only when the copy version changes.
  useEffect(() => {
    if (!accountKey) return;
    const accepted = isDisclosureAccepted(accountKey);
    setDisclosureAccepted(accepted);
    if (!accepted) setShowGate(true);
  }, [accountKey]);

  const handleAcceptDisclosure = useCallback(() => {
    if (!accountKey) return;
    acceptDisclosure(accountKey);
    setDisclosureAccepted(true);
    setShowGate(false);
  }, [accountKey]);

  /**
   * Leave the page — always return to the screen the user actually came from.
   * When they never accepted the disclosure, the origin screen is told why in
   * neutral language (no warning styling).
   */
  const handleExit = useCallback((opts?: { cancelledGate?: boolean }) => {
    const blocked = Boolean(opts?.cancelledGate) || !disclosureAccepted;
    if (blocked) setTlhCancelNotice(origin ?? 'strategies');
    if (origin) {
      router.push(tlhOriginPath(origin));
      return;
    }
    returnToApp(router);
  }, [origin, disclosureAccepted, router]);

  // ─── Derived ─────────────────────────────────────────────
  const lossPositions = useMemo(() =>
    positions.filter(p => p.unrealizedPL < 0)
      .sort((a, b) => a.unrealizedPL - b.unrealizedPL),
    [positions],
  );

  const totalTaxSavings = useMemo(() =>
    Object.values(selectedHarvests).reduce((s, h) => s + (h.estTaxSavings || 0), 0),
    [selectedHarvests],
  );

  const selectedCount = Object.keys(selectedHarvests).length;
  const replacementCount = Object.keys(selectedReplacements).length;

  // A live, tradeable connection can place a real sell order from here.
  const canTrade = isConnected && !isReadOnly;

  // ── Holding-period breakdown per loss position ──────────
  // Short- vs long-term comes from the FIFO lot ledger, never from a single
  // assumed rate. Shares with no tracked lot are reported as unknown and are
  // excluded from the estimate instead of being approximated.
  const lossBreakdowns = useMemo(() => {
    const asOf = new Date();
    const map: Record<string, PositionHoldingPerformance> = {};
    for (const p of lossPositions) {
      map[p.symbol] = computePositionHoldingPeriod(
        {
          symbol: p.symbol,
          qty: p.qty,
          avgCost: p.qty > 0 ? p.costBasis / p.qty : 0,
          currentPrice: p.currentPrice,
          marketValue: p.marketValue,
        },
        lotsBySymbol[p.symbol] || [],
        asOf,
      );
    }
    return map;
  }, [lossPositions, lotsBySymbol]);

  const taxSummary = useMemo(
    () => summarizeTaxEstimate(Object.values(lossBreakdowns)),
    [lossBreakdowns],
  );

  // Losses we could NOT date (no purchase date on file). These keep an
  // illustrative range so the page never reports a bare $0.00 — a portfolio
  // estimate that reads as "no benefit exists" is worse than a labelled guess.
  const illustrative = useMemo(
    () => illustrativeEstimate(Object.values(lossBreakdowns)),
    [lossBreakdowns],
  );
  const hasPrecise = taxSummary.estimatedSavings > 0;
  // Headline: the precise figure when we have one, otherwise the illustrative low
  // end of the range (never $0.00 while there are real harvestable losses).
  const headlineLow = hasPrecise
    ? taxSummary.estimatedSavings + (illustrative?.low ?? 0)
    : (illustrative?.low ?? 0);
  const headlineHigh = hasPrecise
    ? taxSummary.estimatedSavings + (illustrative?.high ?? 0)
    : (illustrative?.high ?? 0);
  const showRange = !hasPrecise && !!illustrative;

  // ── Year-to-date unrealized P&L ─────────────────────────
  // Distinct from the since-inception Total on Insights: this measures what the
  // CURRENT holdings have done since the prior year's close.
  const ytdStats = useMemo(() => {
    let unrealized = 0;
    let covered = 0;
    let missing = 0;
    for (const p of positions) {
      const q = ytdQuotes[p.symbol];
      const price = p.currentPrice > 0 ? p.currentPrice : q?.latestClose || 0;
      if (!q || !(price > 0)) { missing += 1; continue; }
      unrealized += (price - q.yearStartClose) * p.qty;
      covered += 1;
    }
    return { unrealized, covered, missing };
  }, [positions, ytdQuotes]);

  // Recurring-year projection off the rate-corrected estimate. When nothing could
  // be dated precisely we project off the illustrative midpoint instead of
  // rendering an empty state — otherwise a data gap silently hides the section.
  const savingsBasis = hasPrecise
    ? taxSummary.estimatedSavings
    : illustrative
      ? (illustrative.low + illustrative.high) / 2
      : 0;
  const savingsRange = useMemo(
    () => annualSavingsRange(savingsBasis),
    [savingsBasis],
  );

  // ─── Handlers ────────────────────────────────────────────
  const handleHarvest = useCallback((pos: Position) => {
    const washStatus = washSaleStatuses[pos.symbol];
    const isWashBlocked = washStatus && !washStatus.isSafe;

    setSelectedHarvests(prev => {
      if (prev[pos.symbol]) {
        const next = { ...prev };
        delete next[pos.symbol];
        return next;
      }
      const loss = Math.abs(pos.unrealizedPL);
      const bd = lossBreakdowns[pos.symbol];
      return {
        ...prev,
        [pos.symbol]: {
          symbol: pos.symbol,
          qty: pos.qty,
          costBasis: pos.costBasis,
          currentPrice: pos.currentPrice,
          loss,
          lossPct: Math.abs(pos.unrealizedPLPct),
          // Rate-corrected estimate: short-term losses at the assumed ordinary
          // rate, long-term at the long-term rate. Shares with no acquisition
          // date contribute $0 rather than a guessed number.
          estTaxSavings: bd ? bd.estimatedSavings : 0,
        },
      };
    });
  }, [washSaleStatuses, lossBreakdowns]);

  // Open the REAL pre-filled sell ticket for one position (tradeable accounts).
  // Same ticket, same execution route, same FIFO/wash-sale disclosure as the
  // Portfolio sell flow — the harvest is just a pre-filled sell of that
  // position, targeting the same lots the ledger would consume.
  const openHarvestTicket = useCallback((pos: Position) => {
    setHarvestTicket({ symbol: pos.symbol, price: pos.currentPrice });
  }, []);

  // ─── Plan download (.xlsx) ────────────────────────────────
  // Available in BOTH access modes — a read-only connection can't place orders
  // from Vantage, so the download is the only way to act on the review.
  // Same transport + styling as the rebalancing plan export.
  const handleDownload = useCallback(async () => {
    if (downloading || lossPositions.length === 0) return;
    setDownloading(true);
    try {
      const positionsPayload = lossPositions.map(p => {
        const bd = lossBreakdowns[p.symbol];
        const wash = washSaleStatuses[p.symbol];
        return {
          symbol: p.symbol,
          name: p.name ?? null,
          qty: p.qty,
          costBasis: p.costBasis,
          marketValue: p.marketValue,
          unrealizedLoss: -Math.abs(p.unrealizedPL),
          unrealizedLossPct: -Math.abs(p.unrealizedPLPct),
          holdingPeriod: bd?.label ?? 'Unknown',
          estTaxSavings: bd ? bd.estimatedSavings : 0,
          washSaleSafe: wash ? wash.isSafe : undefined,
          daysSinceLastTrade: wash?.daysSinceLastTrade ?? null,
          washSaleStatus: wash
            ? (wash.isSafe
                ? wash.historyAvailable === false
                  ? 'Not checked — no trade history on file for this account'
                  : 'Clear'
                : `Blocked — purchased ${wash.daysSinceLastTrade} day${wash.daysSinceLastTrade === 1 ? '' : 's'} ago`)
            : 'Not checked',
        };
      });
      // Blended rate actually used for the headline figure. The old code sent
      // `precise / totalLosses`, which is 0.00% whenever nothing could be dated —
      // and a 0.00% "assumed rate" with a $0.00 savings line reads as "no tax
      // benefit exists" rather than "we couldn't date these positions". Undated
      // losses are now priced at the illustrative assumption and labelled.
      const illustrativeMid = illustrative ? (illustrative.low + illustrative.high) / 2 : 0;
      const effectiveRate = taxSummary.totalLosses > 0
        ? (taxSummary.estimatedSavings + illustrativeMid) / taxSummary.totalLosses
        : null;
      const fallbackRate = (SHORT_TERM_ASSUMED_RATE + LONG_TERM_ASSUMED_RATE) / 2;
      const res = await apiPost('/api/strategies/tax-harvest/export', {
        accountName: accountLabel || (isDemo ? 'Demo Portfolio' : 'Portfolio'),
        broker: accountBroker,
        environment: accountEnvironment,
        access: canTrade ? 'trading' : 'read-only',
        isDemo,
        taxYear: new Date().getFullYear(),
        estimatedTaxRate: effectiveRate && effectiveRate > 0 ? effectiveRate : fallbackRate,
        preciseSavings: taxSummary.estimatedSavings,
        illustrative: illustrative
          ? {
              loss: illustrative.loss,
              low: illustrative.low,
              high: illustrative.high,
              positionCount: illustrative.positionCount,
              note: illustrativeNote(illustrative),
            }
          : null,
        positions: positionsPayload,
        note: illustrative
          ? illustrativeNote(illustrative)
          : null,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setToast(err?.error || 'Download failed');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] || 'vantage-tax-harvest-plan.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setToast('✓ Plan downloaded (.xlsx)');
    } catch {
      setToast('Network error');
    } finally {
      setDownloading(false);
    }
  }, [downloading, lossPositions, lossBreakdowns, washSaleStatuses, accountLabel, accountBroker, accountEnvironment, isDemo, canTrade, taxSummary, illustrative]);

  const handleSelectReplacement = useCallback((symbol: string, replacement: { symbol: string; name: string; price: number }) => {
    setSelectedReplacements(prev => {
      if (prev[symbol]?.symbol === replacement.symbol) {
        const next = { ...prev };
        delete next[symbol];
        return next;
      }
      return { ...prev, [symbol]: replacement };
    });
  }, []);

  const handleExecute = async () => {
    // Read-only connections can't place orders — defensive guard (button is
    // already disabled, but never execute on view-only).
    if (isReadOnly) {
      setToast('Read-only account — trading unavailable');
      return;
    }
    setSubmitting(true);
    try {
      const res = await await apiPost('/api/strategies/tax-harvest/execute', {
          harvests: Object.values(selectedHarvests),
          replacements: selectedReplacements,
          taxYear: currentYear,
        });
      if (res.ok) {
        setShowConfirm(false);
        setSelectedHarvests({});
        setSelectedReplacements({});
        setToast('✓ Harvest complete');
      } else {
        const err = await res.json();
        setToast(err.error || 'Execution failed');
      }
    } catch {
      setToast('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div className="strategy-page" style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--v-canvas)', color: 'var(--v-text-primary)', padding: '16px 16px 300px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, animation: 'dcaToastIn 0.25s ease-out', background: 'var(--v-gain-label)', color: 'var(--v-accent-text)', padding: '8px 18px', borderRadius: 9999, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => handleExit()} data-testid="harvest-back" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--v-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit' }}>
            <ArrowLeft size={16} /> Back
          </button>
          <span style={{ padding: '4px 10px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 9999, fontSize: 11, fontWeight: 700, color: 'var(--v-text-muted)' }}>
            {currentYear} Tax Year
          </span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--v-text-primary)', margin: '8px 0 6px' }}>Tax Loss Harvesting</h1>
        <p style={{ fontSize: 13, color: 'var(--v-text-muted)', margin: 0 }}>Offset gains and reduce your tax bill</p>
        {showUrgency && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 8, fontSize: 12, color: 'var(--v-warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} />
            <span>⚠️ Year-end deadline approaching. Losses must be realized by Dec 31.</span>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
          <div style={{ width: 24, height: 24, border: '3px solid var(--v-card-border)', borderTopColor: 'var(--v-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}

      {loadError && (
        <div style={{ padding: 16, background: 'var(--v-loss-dim)', border: '1px solid var(--v-loss-dim)', borderRadius: 8, fontSize: 13, color: 'var(--v-loss-label)', marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      {isDemo && !loading && (
        <div style={{ padding: '8px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 8, fontSize: 11, fontWeight: 600, color: 'var(--v-warn)', marginBottom: 16, textAlign: 'center' }}>
          ⚠️ Demo mode — connect broker to harvest real losses
        </div>
      )}

      {isReadOnly && !loading && (
        <div style={{ padding: '8px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 8, fontSize: 11, fontWeight: 600, color: 'var(--v-warn)', marginBottom: 16, textAlign: 'center' }}>
          ⚠️ Read-only account — you can review harvest opportunities but can't execute trades
        </div>
      )}

      {/* ─── Persistent tax-estimate disclosure banner ──────────────
          Stacked with (never merged into) the read-only / demo notices above.
          Same amber informational banner treatment as those notices. */}
      {!loading && (
        <div
          data-testid="tlh-estimate-banner"
          style={{ padding: '8px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 8, fontSize: 11, fontWeight: 600, color: 'var(--v-warn)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5 }}
        >
          <span>⚠️</span>
          <span>{TLH_DISCLOSURE_BANNER_TEXT}</span>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {/* ─── Section 0a: Year-to-Date ─────────────── */}
          <Section icon={<Activity size={12} />} label="Year to Date">
            <div data-testid="ytd-unrealized" style={{ padding: '12px 14px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    YTD Unrealized P&amp;L
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: ytdStats.unrealized >= 0 ? 'var(--v-gain)' : 'var(--v-loss)' }}>
                    {ytdStats.unrealized >= 0 ? '+' : '-'}${Math.abs(ytdStats.unrealized).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.5 }}>
                  <div>{ytdStats.covered} of {positions.length} positions priced since Dec 31</div>
                  <div>Since Jan 1 &mdash; unrealized, on today&apos;s holdings</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.5, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--v-card-border)' }}>
                This is this year&apos;s move only. The since-inception total you see on Insights includes earlier years.
                {ytdLoading && ' Loading year-start prices…'}
                {ytdStats.missing > 0 && ` ${ytdStats.missing} position${ytdStats.missing === 1 ? '' : 's'} had no year-start price available.`}
              </div>
            </div>
          </Section>

          {/* ─── Section 0: Ongoing Monitoring ──────── */}
          <Section icon={<Activity size={12} />} label="Ongoing Monitoring">
            <div style={{ padding: '12px 14px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 10, fontSize: 12, color: 'var(--v-text-muted)', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}>
                This page isn't a one-time snapshot. Vantage keeps watching your portfolio after you leave it — it scans your holdings as prices move and flags new harvest opportunities as they appear through the tax year.
              </p>
              <p style={{ margin: 0 }}>
                When a position crosses into a meaningful unrealized loss, it surfaces here, along with any wash-sale restrictions on recently purchased shares. You review and decide; nothing is ever sold without your confirmation.
              </p>
            </div>
          </Section>

          {/* ─── Section 1: YTD Summary ──────────────── */}
          <Section icon={<Activity size={12} />} label="YTD Summary">
            {tradeSummary.realizedGains === 0 && tradeSummary.realizedLosses === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--v-text-secondary)', padding: '12px 0', textAlign: 'center' }}>
                No realized gains or losses yet this year
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <SummaryCard label="Realized Gains" value={tradeSummary.realizedGains} color="var(--v-gain)" />
                  <SummaryCard label="Realized Losses" value={Math.abs(tradeSummary.realizedLosses)} color="var(--v-loss)" />
                  <SummaryCard label="Net Position" value={tradeSummary.netPosition} color={tradeSummary.netPosition >= 0 ? 'var(--v-gain)' : 'var(--v-loss)'} />
                </div>
                {tradeSummary.realizedGains > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--v-text-secondary)', padding: '8px 12px', background: 'var(--v-card)', borderRadius: 8, marginBottom: 10 }}>
                    Harvestable losses could offset about <strong style={{ color: 'var(--v-gain)' }}>${taxSummary.estimatedSavings.toFixed(2)}</strong> of tax, estimated from each position&apos;s actual holding period
                  </div>
                )}
              </>
            )}

            {/* Tax estimate — per-position holding period, not one flat rate */}
            <div data-testid="tax-rate-breakdown" style={{ padding: '12px 14px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Estimated Tax Savings on Harvestable Losses
              </div>
              {showRange ? (
                <>
                  <div data-testid="tax-estimate-headline" style={{ fontSize: 20, fontWeight: 800, color: 'var(--v-gain)', marginBottom: 4 }}>
                    ${illustrative!.low.toFixed(2)} – ${illustrative!.high.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                    Illustrative range — no position has a purchase date on file yet, so this is priced at a general
                    {' '}{Math.round(ILLUSTRATIVE_LOW_RATE * 100)}%–{Math.round(ILLUSTRATIVE_HIGH_RATE * 100)}% assumption rather than a per-position rate.
                  </div>
                </>
              ) : (
                <>
                  <div data-testid="tax-estimate-headline" style={{ fontSize: 20, fontWeight: 800, color: 'var(--v-gain)', marginBottom: 4 }}>
                    ${taxSummary.estimatedSavings.toFixed(2)}
                  </div>
                  {illustrative && (
                    <div data-testid="tax-estimate-illustrative-total" style={{ fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                      Plus an illustrative ${illustrative.low.toFixed(2)}–${illustrative.high.toFixed(2)} on {illustrative.positionCount} position{illustrative.positionCount === 1 ? '' : 's'} with no purchase date — total
                      {' '}${(taxSummary.estimatedSavings + illustrative.low).toFixed(2)}–${(taxSummary.estimatedSavings + illustrative.high).toFixed(2)}.
                    </div>
                  )}
                </>
              )}

              {/* Rate split by holding period */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                <div data-testid="tax-rate-short-term" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--v-text-secondary)' }}>
                  <span>
                    Short-term losses <span style={{ color: 'var(--v-text-muted)' }}>(held ≤ 1 year)</span>
                  </span>
                  <span style={{ color: 'var(--v-text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    ${taxSummary.shortTermLoss.toFixed(2)} × {Math.round(SHORT_TERM_ASSUMED_RATE * 100)}% = ${taxSummary.shortTermSavings.toFixed(2)}
                  </span>
                </div>
                <div data-testid="tax-rate-long-term" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--v-text-secondary)' }}>
                  <span>
                    Long-term losses <span style={{ color: 'var(--v-text-muted)' }}>(held &gt; 1 year)</span>
                  </span>
                  <span style={{ color: 'var(--v-text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    ${taxSummary.longTermLoss.toFixed(2)} × {Math.round(LONG_TERM_ASSUMED_RATE * 100)}% = ${taxSummary.longTermSavings.toFixed(2)}
                  </span>
                </div>
                {illustrative && (
                  <div data-testid="tax-rate-unknown" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--v-text-secondary)' }}>
                    <span>
                      No purchase date <span style={{ color: 'var(--v-text-muted)' }}>(illustrative)</span>
                    </span>
                    <span style={{ color: 'var(--v-text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      ${illustrative.loss.toFixed(2)} × {Math.round(ILLUSTRATIVE_LOW_RATE * 100)}–{Math.round(ILLUSTRATIVE_HIGH_RATE * 100)}% = ${illustrative.low.toFixed(2)}–${illustrative.high.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {illustrative && (
                <div data-testid="tax-illustrative-note" style={{ fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.6, padding: '8px 10px', background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 8, marginBottom: 10 }}>
                  {illustrativeNote(illustrative)}
                </div>
              )}

              {/* Recurring-year projection */}
              <div style={{ paddingTop: 10, borderTop: '1px solid var(--v-card-border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  Projected Annual Tax Savings
                </div>
                {savingsRange ? (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--v-gain)', marginBottom: 4 }}>
                      ${savingsRange.low.toFixed(0)} – ${savingsRange.high.toFixed(0)}
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--v-text-muted)' }}> / year</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.5 }}>
                      {hasPrecise
                        ? 'A typical year of recurring opportunities: 25%–50% of the estimate above (a quiet vs. an active year).'
                        : 'A typical year of recurring opportunities: 25%–50% of the illustrative range above (a quiet vs. an active year) — refined as soon as purchase dates are available.'}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.5 }}>
                    Not enough classified losses to project a recurring-year range yet.
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.5, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--v-card-border)' }}>
                {rateBreakdownNote()} Illustrative only — actual results depend on your income and on your full tax picture.
              </div>
            </div>
          </Section>

          {/* ─── Section 2: Loss Positions ───────────── */}
          <Section icon={<TrendingDown size={12} />} label="Loss Positions">
            {lossPositions.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--v-text-secondary)', padding: '12px 0', textAlign: 'center' }}>
                No harvestable losses in your portfolio
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lossPositions.map(pos => {
                  const isSelected = !!selectedHarvests[pos.symbol];
                  const wash = washSaleStatuses[pos.symbol];
                  const isWashBlocked = wash && !wash.isSafe;
                  const washUnchecked = !!wash && wash.isSafe && wash.historyAvailable === false;
                  const replacement = selectedReplacements[pos.symbol];
                  const suggestions = getReplacementSuggestions(pos.sector);
                  const bd = lossBreakdowns[pos.symbol];
                  const periodPill = bd?.label === 'Short-term'
                    ? { text: 'Short-term ≤ 1 yr', color: 'var(--v-warn)' }
                    : bd?.label === 'Long-term'
                      ? { text: 'Long-term > 1 yr', color: 'var(--v-gain)' }
                      : bd?.label === 'Mixed'
                        ? { text: 'Mixed short & long', color: 'var(--v-accent-label)' }
                        : { text: 'Holding period unknown', color: 'var(--v-text-muted)' };

                  return (
                    <div key={pos.symbol} style={{ padding: 12, background: 'var(--v-card)', border: `1px solid ${isSelected ? 'var(--v-accent)' : 'var(--v-card-border)'}`, borderRadius: 10, transition: 'border-color 0.2s' }}>
                      {/* Position info */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontWeight: 700, color: 'var(--v-text-primary)', fontSize: 14 }}>{pos.symbol}</span>
                          <span style={{ fontSize: 11, color: 'var(--v-text-secondary)', marginLeft: 8 }}>{pos.name}</span>
                          <div data-testid={`holding-period-${pos.symbol}`} style={{ fontSize: 10, fontWeight: 700, color: periodPill.color, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                            {periodPill.text}
                            {bd && bd.lots.length > 0 && bd.unknownQty === 0 && bd.lots.length > 1 ? ` · ${bd.lots.length} lots` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-loss)' }}>
                          -${Math.abs(pos.unrealizedPL).toFixed(2)} ({pos.unrealizedPLPct.toFixed(1)}%)
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 11, color: 'var(--v-text-muted)', marginBottom: 8 }}>
                        <span>Cost: ${pos.costBasis.toFixed(2)}</span>
                        <span>Current: ${pos.marketValue.toFixed(2)}</span>
                        <span style={{ color: bd && (bd.estimatedSavings > 0 || bd.unknownLoss > 0) ? 'var(--v-gain)' : 'var(--v-text-muted)' }}>
                          {bd && bd.estimatedSavings > 0
                            ? `Savings: $${bd.estimatedSavings.toFixed(2)}`
                            : bd && bd.unknownLoss > 0
                              // No purchase date for this position — show the labelled
                              // illustrative range instead of a bare, misleading "—".
                              ? `Savings: ~$${(bd.unknownLoss * ILLUSTRATIVE_LOW_RATE).toFixed(2)}–$${(bd.unknownLoss * ILLUSTRATIVE_HIGH_RATE).toFixed(2)} (illustrative)`
                              : 'Savings: —'}
                        </span>
                      </div>

                      {/* Wash sale status */}
                      <div data-testid={`wash-sale-${pos.symbol}`} style={{ fontSize: 11, color: isWashBlocked ? 'var(--v-warn)' : washUnchecked ? 'var(--v-text-muted)' : 'var(--v-gain)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {isWashBlocked ? (
                          <>
                            <AlertTriangle size={12} />
                            <span>⚠️ Wash sale risk — bought {wash.daysSinceLastTrade} days ago</span>
                          </>
                        ) : washUnchecked ? (
                          <>
                            <AlertTriangle size={12} />
                            {/* No trade history for THIS account ⇒ we cannot run the
                                30-day window. Say so instead of claiming "safe". */}
                            <span>Wash-sale window not available — no trade history on file for this account. Confirm with your broker before selling.</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle size={12} />
                            <span>✅ Safe to harvest</span>
                          </>
                        )}
                      </div>

                      {/* Harvest button + replacement */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: isSelected ? 10 : 0 }}>
                        {canTrade ? (
                          <button
                            onClick={() => openHarvestTicket(pos)}
                            disabled={isWashBlocked}
                            data-testid={`harvest-ticket-${pos.symbol}`}
                            style={{
                              flex: 1, padding: '8px 12px',
                              background: isWashBlocked ? 'var(--v-card)' : 'var(--v-accent)',
                              border: `1px solid ${isWashBlocked ? 'var(--v-card-border)' : 'var(--v-accent)'}`,
                              borderRadius: 8, color: isWashBlocked ? 'var(--v-text-faint)' : 'var(--v-accent-text)',
                              fontSize: 12, fontWeight: 700, cursor: isWashBlocked ? 'not-allowed' : 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {isWashBlocked ? 'Blocked — Wash Sale' : 'Harvest Loss'}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleHarvest(pos)}
                            disabled={isWashBlocked || isReadOnly}
                            data-testid={`harvest-ticket-${pos.symbol}`}
                            style={{
                              flex: 1, padding: '8px 12px',
                              background: isSelected ? 'var(--v-card-border)' : 'var(--v-card)',
                              border: `1px solid ${isSelected ? 'var(--v-accent)' : 'var(--v-card-border)'}`,
                              borderRadius: 8, color: isSelected ? 'var(--v-accent)' : isWashBlocked || isReadOnly ? 'var(--v-text-faint)' : 'var(--v-text-muted)',
                              fontSize: 12, fontWeight: 600, cursor: isWashBlocked || isReadOnly ? 'not-allowed' : 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {isWashBlocked
                              ? 'Blocked — Wash Sale'
                              : isReadOnly
                                ? 'Review only — read-only account'
                                : isSelected ? 'Deselect' : 'Harvest Loss'}
                          </button>
                        )}
                      </div>

                      {/* Replacement suggestions */}
                      {isSelected && (
                        <div style={{ padding: '10px 12px', background: 'var(--v-accent-dim)', border: '1px solid var(--v-accent-dim)', borderRadius: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--v-text-secondary)', marginBottom: 8 }}>
                            To maintain market exposure, consider buying:
                          </div>
                          {suggestions.slice(0, 2).map((s, i) => {
                            const isReplacement = replacement?.symbol === s.symbol;
                            return (
                              <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: i > 0 ? '1px solid var(--v-card)' : 'none' }}>
                                <div>
                                  <span style={{ fontWeight: 700, color: 'var(--v-text-primary)', fontSize: 12 }}>{s.symbol}</span>
                                  <span style={{ fontSize: 10, color: 'var(--v-text-secondary)', marginLeft: 6 }}>{s.name}</span>
                                </div>
                                <button
                                  onClick={() => handleSelectReplacement(pos.symbol, { ...s, price: pos.currentPrice * 0.95 })}
                                  style={{
                                    padding: '4px 10px',
                                    background: isReplacement ? 'var(--v-accent)' : 'none',
                                    border: `1px solid ${isReplacement ? 'var(--v-accent)' : 'var(--v-card-border)'}`,
                                    borderRadius: 6, color: isReplacement ? 'var(--v-accent-text)' : 'var(--v-text-muted)',
                                    fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {isReplacement ? 'Selected' : 'Select'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ─── Section 3: Wash Sale Rule ───────────── */}
          <Section icon={<AlertTriangle size={12} />} label="Wash Sale Rule">
            <button
              onClick={() => setShowWashRule(!showWashRule)}
              style={{ width: '100%', padding: '10px 14px', background: 'var(--v-warn-dim)', border: '1px solid var(--v-warn-dim)', borderRadius: 8, color: 'var(--v-warn)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={12} /> Wash Sale Rule
              </span>
              {showWashRule ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showWashRule && (
              <div style={{ padding: '12px 14px', marginTop: 8, background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 8, fontSize: 11, color: 'var(--v-text-muted)', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 8px' }}>
                  <strong style={{ color: 'var(--v-warn)' }}>You cannot repurchase the same security</strong> within 30 days before or after selling it for a loss.
                  If you do, the IRS disallows the loss deduction.
                </p>
                <p style={{ margin: 0 }}>
                  Vantage automatically checks your last 30 days of trades. Position cards marked with <span style={{ color: 'var(--v-loss)' }}>⚠️ Wash sale risk</span> have recent purchases.
                </p>
                {Object.values(washSaleStatuses).some(s => s.isSafe && s.historyAvailable === false) && (
                  <p style={{ margin: '8px 0 0', color: 'var(--v-text-muted)' }}>
                    This account has no trade history on file with Vantage — shares were imported from your broker, which doesn&apos;t
                    report per-share purchase dates. The 30-day window can&apos;t be evaluated here, so those positions are labelled
                    rather than marked safe; confirm before selling.
                  </p>
                )}
                {/* Show blocked positions */}
                {Object.entries(washSaleStatuses).filter(([, s]) => !s.isSafe).length > 0 && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--v-warn-dim)', borderRadius: 6 }}>
                    <div style={{ fontWeight: 600, color: 'var(--v-warn)', marginBottom: 4 }}>⚠️ Restricted positions:</div>
                    {Object.entries(washSaleStatuses).filter(([, s]) => !s.isSafe).map(([sym, status]) => (
                      <div key={sym} style={{ fontSize: 11, color: 'var(--v-warn)' }}>
                        {sym} — bought {status.daysSinceLastTrade} days ago
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ─── Section 4: Harvest Summary ──────────── */}
          {selectedCount > 0 && (
            <Section icon={<Info size={12} />} label="Harvest Summary">
              <div style={{ padding: 14, background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Selected Harvests
                </div>
                {Object.values(selectedHarvests).map(h => (
                  <div key={h.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--v-card)', fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: 'var(--v-text-primary)' }}>{h.symbol}</span>
                    <span style={{ color: 'var(--v-text-muted)' }}>Sell {h.qty} shares</span>
                    <span style={{ color: 'var(--v-loss)' }}>-${h.loss.toFixed(2)}</span>
                    <span style={{ color: h.estTaxSavings > 0 ? 'var(--v-gain)' : 'var(--v-text-muted)' }}>
                      {h.estTaxSavings > 0 ? `$${h.estTaxSavings.toFixed(2)} saved` : '— holding period unknown'}
                    </span>
                  </div>
                ))}

                {replacementCount > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 8px' }}>
                      Replacements
                    </div>
                    {Object.entries(selectedReplacements).map(([sym, r]) => (
                      <div key={sym} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--v-card)', fontSize: 12 }}>
                        <span style={{ fontWeight: 600, color: 'var(--v-accent)' }}>{r.symbol}</span>
                        <span style={{ color: 'var(--v-text-muted)' }}>{r.name}</span>
                        <span style={{ color: 'var(--v-text-secondary)' }}>Buy ${(selectedHarvests[sym]?.loss || 0).toFixed(2)} worth</span>
                      </div>
                    ))}
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', borderTop: '1px solid var(--v-card-border)', marginTop: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--v-text-secondary)' }}>Total Est. Tax Savings</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--v-gain)' }}>${totalTaxSavings.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--v-text-secondary)' }}>Total Transactions</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--v-text-primary)' }}>{selectedCount + replacementCount}</div>
                  </div>
                </div>
              </div>
            </Section>
          )}
        </>
      )}

      {/* ─── Bottom Bar ────────────────────────────── */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'linear-gradient(to top, var(--v-canvas) 80%, transparent)', padding: '12px 16px 84px', borderTop: '1px solid var(--v-card)' }}>
        {!isConnected && selectedCount > 0 && (
          <div style={{ fontSize: 10, color: 'var(--v-warn)', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Demo mode — connect broker to execute live trades
          </div>
        )}
        {isReadOnly && selectedCount > 0 && (
          <div style={{ fontSize: 10, color: 'var(--v-warn)', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
            ⚠️ Read-only account — trading unavailable
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={selectedCount === 0 || submitting || !isConnected || isReadOnly}
            style={{
              flex: 1, padding: 14, borderRadius: 10, border: 'none',
              background: selectedCount > 0 && !submitting && isConnected && !isReadOnly ? 'linear-gradient(135deg, var(--v-accent), var(--v-accent))' : 'var(--v-disabled-bg)',
              color: selectedCount > 0 && !submitting && isConnected && !isReadOnly ? 'var(--v-accent-text)' : 'var(--v-disabled-text)',
              fontSize: 15, fontWeight: 700,
              cursor: selectedCount > 0 && !submitting && isConnected && !isReadOnly ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', transition: 'all 0.2s ease',
            }}
          >
            {submitting ? 'Executing...' : isReadOnly ? 'Read-only — unavailable' : isConnected ? `Execute Harvest (${selectedCount})` : 'Connect Broker to Execute'}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || lossPositions.length === 0}
            data-testid="harvest-download"
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--v-card-border)', background: 'var(--v-card)', color: downloading || lossPositions.length === 0 ? 'var(--v-disabled-text)' : 'var(--v-text-primary)', fontSize: 12, fontWeight: 700, cursor: downloading || lossPositions.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={13} />
            {downloading ? 'Preparing…' : '.xlsx'}
          </button>
          <button onClick={() => handleExit()} data-testid="harvest-cancel" style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', color: 'var(--v-text-secondary)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Cancel
          </button>
        </div>
      </div>

      {/* ─── Confirm Modal ────────────────────────── */}
      {showConfirm && (
        <div onClick={() => setShowConfirm(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 16, padding: 24 }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--v-text-primary)', margin: '0 0 8px' }}>Confirm Harvest</h3>
            <p style={{ fontSize: 13, color: 'var(--v-text-muted)', margin: '0 0 16px' }}>
              This will sell <strong style={{ color: 'var(--v-text-primary)' }}>{selectedCount} positions</strong>
              {replacementCount > 0 && <> and buy <strong style={{ color: 'var(--v-text-primary)' }}>{replacementCount} replacements</strong></>}.
            </p>
            <div style={{ padding: 12, background: 'var(--v-accent-dim)', borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--v-gain)', marginBottom: 4 }}>
                Est. tax savings: ${totalTaxSavings.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--v-warn)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={11} />
                Do not repurchase harvested stocks for 30 days.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: 12, background: 'none', border: '1px solid var(--v-card-border)', borderRadius: 8, color: 'var(--v-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleExecute} disabled={submitting} style={{ flex: 1, padding: 12, background: submitting ? 'var(--v-disabled-bg)' : 'linear-gradient(135deg, var(--v-accent), var(--v-accent))', border: 'none', borderRadius: 8, color: submitting ? 'var(--v-disabled-text)' : 'var(--v-accent-text)', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                {submitting ? 'Executing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Disclosure gate ────────────────────────
          Blocking, shown on first entry for this account and again only if the
          disclosure copy version changes. */}
      <TaxHarvestDisclosureGate
        isOpen={showGate && !loading}
        accountLabel={accountLabel || undefined}
        onAccept={handleAcceptDisclosure}
        onCancel={() => handleExit({ cancelledGate: true })}
      />

      {/* ─── Real pre-filled sell ticket (tradeable accounts) ──
          The same TradeTicket the Portfolio sell flow uses, pre-filled for this
          position and the same lots the FIFO ledger would consume. */}
      {harvestTicket && (() => {
        const pos = positions.find(p => p.symbol === harvestTicket.symbol);
        if (!pos) return null;
        return (
          <TradeTicket
            isOpen
            onClose={() => setHarvestTicket(null)}
            symbol={pos.symbol}
            side="SELL"
            currentPrice={harvestTicket.price}
            sharesHeld={pos.qty}
            availableCash={0}
            initialShares={pos.qty}
            companyName={pos.name}
            lots={toFifoLots(lotsBySymbol[pos.symbol], pos.symbol)}
            onConfirm={async (params) => {
              const res = await apiPost('/api/broker/execute-trade', {
                symbol: pos.symbol,
                side: 'SELL',
                shares: params.shares,
                orderType: params.type,
                dollarAmount: params.dollarAmount,
                limitPrice: params.limitPrice,
                stopPrice: params.stopPrice,
                timeInForce: params.timeInForce,
                currentPrice: harvestTicket.price,
                expectedCompanyName: pos.name,
              });
              if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || 'Order failed');
              }
              setHarvestTicket(null);
              setToast('✓ Sell order submitted — harvest in progress');
            }}
          />
        );
      })()}

      <style>{`@keyframes dcaToastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-accent-label)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--v-card)', borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--v-text-secondary)', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color }}>
        {value < 0 ? '-' : ''}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}

// ─── Helper: sector guess by symbol ─────────────────────────
function getSectorForSymbol(symbol: string): string {
  const map: Record<string, string> = {
    AAPL: 'technology', MSFT: 'technology', NVDA: 'technology', GOOGL: 'communication services',
    AMZN: 'consumer cyclical', META: 'communication services', TSLA: 'consumer cyclical',
    BRK_B: 'financial', JPM: 'financial', BAC: 'financial', WFC: 'financial',
    UNH: 'healthcare', JNJ: 'healthcare', PFE: 'healthcare', ABBV: 'healthcare',
    XOM: 'energy', CVX: 'energy', COP: 'energy',
    HD: 'consumer cyclical', KO: 'consumer defensive', PG: 'consumer defensive',
    CRM: 'technology', ADBE: 'technology', INTC: 'technology', AMD: 'technology',
    DIS: 'communication services', NFLX: 'communication services',
  };
  return map[symbol] || 'technology';
}

// ─── YTD trade summary loader ───────────────────────────────
async function loadTradeSummary(connected: boolean): Promise<TradeSummary> {
  // Try DB trade history first
  try {
    const res = await await apiGet('/api/db/trade-history/sync');
    if (res.ok) {
      const data = await res.json();
      const currentYear = getCurrentYear();
      const yearStart = `${currentYear}-01-01`;
      const trades = (data.trades || []).filter((t: any) => t.filled_at >= yearStart);
      let gains = 0;
      let losses = 0;
      for (const t of trades) {
        const pl = t.realized_pl || t.realizedPL || 0;
        if (pl > 0) gains += pl;
        else losses += Math.abs(pl);
      }
      return { realizedGains: gains, realizedLosses: losses, netPosition: gains - losses };
    }
  } catch { /* fallback */ }

  // Fallback: estimated demo values
  if (!connected) {
    return { realizedGains: 2500, realizedLosses: 800, netPosition: 1700 };
  }

  return { realizedGains: 0, realizedLosses: 0, netPosition: 0 };
}
