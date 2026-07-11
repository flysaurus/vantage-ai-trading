// ─── NYSE Holiday Calendar ───────────────────────────────────
// Source: NYSE official holiday schedule (https://www.nyse.com/markets/hours-calendars)
// Last reviewed: July 2026. Review annually — holidays valid through end of 2026.
//
// FULL-DAY CLOSURES (market closed all day):
//   New Year's Day, MLK Day, Presidents Day, Good Friday, Memorial Day,
//   Juneteenth (June 19), Independence Day (July 4 or observed),
//   Labor Day, Thanksgiving, Christmas
//
// EARLY CLOSE (market closes at 1:00 PM ET, 780 minutes):
//   Day before Independence Day (if weekday), Black Friday (day after Thanksgiving),
//   Christmas Eve (Dec 24, if weekday)

const NYSE_FULL_DAY_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day (Wed)
  '2025-01-20', // Martin Luther King Jr. Day (Mon)
  '2025-02-17', // Presidents Day (Mon)
  '2025-04-18', // Good Friday (Fri)
  '2025-05-26', // Memorial Day (Mon)
  '2025-06-19', // Juneteenth National Independence Day (Thu)
  '2025-07-04', // Independence Day (Fri)
  '2025-09-01', // Labor Day (Mon)
  '2025-11-27', // Thanksgiving Day (Thu)
  '2025-12-25', // Christmas Day (Thu)
];

const NYSE_EARLY_CLOSE_2025 = [
  '2025-11-28', // Day after Thanksgiving / Black Friday (Fri) — close 1:00 PM ET
  '2025-12-24', // Christmas Eve (Wed) — close 1:00 PM ET
];

const NYSE_FULL_DAY_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day (Thu)
  '2026-01-19', // Martin Luther King Jr. Day (Mon)
  '2026-02-16', // Presidents Day (Mon)
  '2026-04-03', // Good Friday (Fri)
  '2026-05-25', // Memorial Day (Mon)
  '2026-06-19', // Juneteenth National Independence Day (Fri)
  '2026-07-03', // Independence Day (observed — Jul 4 is Saturday)
  '2026-09-07', // Labor Day (Mon)
  '2026-11-26', // Thanksgiving Day (Thu)
  '2026-12-25', // Christmas Day (Fri)
];

const NYSE_EARLY_CLOSE_2026 = [
  '2026-07-02', // Day before Independence Day observed (Thu) — close 1:00 PM ET
  '2026-11-27', // Day after Thanksgiving / Black Friday (Fri) — close 1:00 PM ET
  '2026-12-24', // Christmas Eve (Thu) — close 1:00 PM ET
];

const NYSE_HOLIDAYS = new Set([
  ...NYSE_FULL_DAY_HOLIDAYS_2025,
  ...NYSE_FULL_DAY_HOLIDAYS_2026,
]);

const NYSE_EARLY_CLOSE = new Set([
  ...NYSE_EARLY_CLOSE_2025,
  ...NYSE_EARLY_CLOSE_2026,
]);

// Market hours in minutes since midnight ET
const MARKET_OPEN_MINUTES = 570;   // 9:30 AM ET
const MARKET_CLOSE_MINUTES = 960;  // 4:00 PM ET (regular)
const EARLY_CLOSE_MINUTES = 780;   // 1:00 PM ET (early-close days)
const PREMARKET_START_MINUTES = 240;  // 4:00 AM ET
const AFTERHOURS_END_MINUTES = 1200; // 8:00 PM ET

// ─── Market Status ───────────────────────────────────────────

export function isMarketOpen(): boolean {
  const { isOpen } = getMarketStatus();
  return isOpen;
}

export interface MarketStatus {
  isOpen: boolean;
  label: string;
  color: string;
  period: 'premarket' | 'open' | 'afterhours' | 'closed';
  nextOpenET: Date | null;
  nextOpenLabel: string;
}

export function getMarketStatus(nowOverride?: Date): MarketStatus {
  const now = nowOverride || new Date();
  const etTime = new Date(
    now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
    })
  );

  const day = etTime.getDay();
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  const isWeekend = day === 0 || day === 6;

  // Format date as YYYY-MM-DD for holiday lookup
  const dateStr = etTime.toISOString().split('T')[0];
  const isFullHoliday = NYSE_HOLIDAYS.has(dateStr);
  const isEarlyClose = NYSE_EARLY_CLOSE.has(dateStr);

  // Effective close time: 1:00 PM on early-close days, 4:00 PM otherwise
  const closeMinutes = isEarlyClose ? EARLY_CLOSE_MINUTES : MARKET_CLOSE_MINUTES;

  // Calculate next market open (first non-weekend, non-holiday at 9:30 AM ET)
  function getNextOpen(): Date {
    const next = new Date(etTime);
    next.setHours(9, 30, 0, 0);

    // If past 9:30am or weekend/holiday, push to next day
    if (timeInMinutes >= MARKET_OPEN_MINUTES || isWeekend || isFullHoliday) {
      next.setDate(next.getDate() + 1);
      // Skip weekends and holidays (early-close days are trading days — don't skip)
      let safety = 0;
      while ((next.getDay() === 0 || next.getDay() === 6 ||
        NYSE_HOLIDAYS.has(next.toISOString().split('T')[0])) && safety < 30) {
        next.setDate(next.getDate() + 1);
        safety++;
      }
    }
    return next;
  }

  function getNextOpenLabel(nextOpen: Date): string {
    const diff = nextOpen.getTime() - now.getTime();
    const hoursUntil = Math.floor(diff / (1000 * 60 * 60));
    const minsUntil = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hoursUntil < 24) {
      return `Opens in ${hoursUntil}h ${minsUntil}m`;
    }
    return `Opens ${nextOpen.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
  }

  // Weekend or full holiday — closed all day
  if (isWeekend || isFullHoliday) {
    const nextOpen = getNextOpen();
    return {
      isOpen: false,
      label: isFullHoliday ? 'MARKET HOLIDAY' : 'CLOSED',
      color: isFullHoliday ? 'text-amber-400 bg-amber-400/10' : 'text-red-400 bg-red-400/10',
      period: 'closed',
      nextOpenET: nextOpen,
      nextOpenLabel: getNextOpenLabel(nextOpen),
    };
  }

  // Pre-market: 4:00 AM - 9:30 AM ET
  if (timeInMinutes >= PREMARKET_START_MINUTES && timeInMinutes < MARKET_OPEN_MINUTES) {
    const nextOpen = getNextOpen();
    return {
      isOpen: false,
      label: isEarlyClose ? 'PRE-MARKET · EARLY CLOSE 1PM' : 'PRE-MARKET',
      color: 'text-yellow-400 bg-yellow-400/10',
      period: 'premarket',
      nextOpenET: nextOpen,
      nextOpenLabel: getNextOpenLabel(nextOpen),
    };
  }

  // Regular hours: 9:30 AM - close time (varies: 4:00 PM or 1:00 PM ET)
  if (timeInMinutes >= MARKET_OPEN_MINUTES && timeInMinutes < closeMinutes) {
    return {
      isOpen: true,
      label: isEarlyClose ? 'OPEN · CLOSES 1PM ET' : 'OPEN',
      color: isEarlyClose ? 'text-yellow-400 bg-yellow-400/10' : 'text-green-400 bg-green-400/10',
      period: 'open',
      nextOpenET: null,
      nextOpenLabel: isEarlyClose ? 'Early close at 1:00 PM ET' : 'Market open',
    };
  }

  // After hours: close time - 8:00 PM ET
  if (timeInMinutes >= closeMinutes && timeInMinutes < AFTERHOURS_END_MINUTES) {
    const nextOpen = getNextOpen();
    return {
      isOpen: false,
      label: isEarlyClose ? 'CLOSED · EARLY CLOSE' : 'AFTER HOURS',
      color: 'text-yellow-400 bg-yellow-400/10',
      period: 'afterhours',
      nextOpenET: nextOpen,
      nextOpenLabel: getNextOpenLabel(nextOpen),
    };
  }

  // Late night — closed
  const nextOpen = getNextOpen();
  return {
    isOpen: false,
    label: 'CLOSED',
    color: 'text-red-400 bg-red-400/10',
    period: 'closed',
    nextOpenET: nextOpen,
    nextOpenLabel: getNextOpenLabel(nextOpen),
  };
}
