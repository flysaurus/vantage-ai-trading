/**
 * GET /api/portfolio/summary — lightweight portfolio snapshot for GreetingModal
 * Returns today P&L, demo status. No sensitive data exposed.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getDemoAccount, getDemoSymbols } from '@/lib/demo-data';
import { getBatchQuotes } from '@/lib/market-data';

type InvestorStyle = 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ isDemo: true, todayPnLPercent: 0, todayPnL: 0 });
    }

    // Get user profile
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    const brokerConnected = (profile as any)?.broker_connected === true;
    const style: InvestorStyle = ((profile as any)?.investor_style || 'buffett') as InvestorStyle;

    if (brokerConnected) {
      try {
        // Try real broker account
        const accountUrl = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/broker/session`;
        const sessionRes = await fetch(accountUrl);
        const sessionData = await sessionRes.json().catch(() => null);
        if (sessionData?.equity) {
          const todayPnL = sessionData.dayPnl || 0;
          const equity = sessionData.equity || 1;
          const todayPnLPercent = (todayPnL / equity) * 100;
          return NextResponse.json({
            isDemo: false,
            todayPnL: parseFloat(todayPnL.toFixed(2)),
            todayPnLPercent: parseFloat(todayPnLPercent.toFixed(2)),
          });
        }
      } catch {
        // Fall through to demo
      }
    }

    // Demo mode — load demo account with live prices for today P&L
    const symbols = getDemoSymbols(style);
    const batchResult = await getBatchQuotes(symbols).catch(() => new Map());
    const livePrices: Record<string, { price: number; change: number; changePercent: number; previousClose: number }> = {};
    batchResult.forEach((quote, symbol) => {
      livePrices[symbol] = {
        price: quote.price,
        change: quote.change ?? 0,
        changePercent: quote.changePercent ?? 0,
        previousClose: quote.previousClose ?? quote.price,
      };
    });
    const demoAccount = getDemoAccount(style, livePrices);
    if (!demoAccount) {
      return NextResponse.json({ isDemo: true, todayPnLPercent: 0, todayPnL: 0 });
    }

    const dayPnL = demoAccount.dayPnl || 0;
    const equity = demoAccount.equity || 10000;
    const dayPnLPercent = equity > 0 ? (dayPnL / equity) * 100 : 0;

    return NextResponse.json({
      isDemo: true,
      todayPnL: parseFloat(dayPnL.toFixed(2)),
      todayPnLPercent: parseFloat(dayPnLPercent.toFixed(2)),
    });
  } catch {
    return NextResponse.json({ isDemo: true, todayPnLPercent: 0, todayPnL: 0 });
  }
}
