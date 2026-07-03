// ─── NYSE Holiday Calendar ───────────────────────────────────

const NYSE_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day
  '2025-01-20', // MLK Day
  '2025-02-17', // Presidents Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving
  '2025-12-25', // Christmas
];

const NYSE_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-11-27', // Day after Thanksgiving (early close)
  '2026-12-25', // Christmas
];

const NYSE_HOLIDAYS = new Set([
  ...NYSE_HOLIDAYS_2025,
  ...NYSE_HOLIDAYS_2026,
]);

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

export function getMarketStatus(): MarketStatus {
  const now = new Date();
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
  const isHoliday = NYSE_HOLIDAYS.has(dateStr);

  // Calculate next market open (first non-weekend, non-holiday at 9:30 AM ET)
  function getNextOpen(): Date {
    const next = new Date(etTime);
    next.setHours(9, 30, 0, 0);

    // If past 9:30am or weekend/holiday, push to next day
    if (timeInMinutes >= 570 || isWeekend || isHoliday) {
      next.setDate(next.getDate() + 1);
      // Skip weekends and holidays
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

  // Weekend or holiday — closed
  if (isWeekend || isHoliday) {
    const nextOpen = getNextOpen();
    return {
      isOpen: false,
      label: isHoliday ? 'MARKET HOLIDAY' : 'CLOSED',
      color: isHoliday ? 'text-amber-400 bg-amber-400/10' : 'text-red-400 bg-red-400/10',
      period: 'closed',
      nextOpenET: nextOpen,
      nextOpenLabel: getNextOpenLabel(nextOpen),
    };
  }

  // Pre-market: 4:00 AM - 9:30 AM ET
  if (timeInMinutes >= 240 && timeInMinutes < 570) {
    const nextOpen = getNextOpen();
    return {
      isOpen: false,
      label: 'PRE-MARKET',
      color: 'text-yellow-400 bg-yellow-400/10',
      period: 'premarket',
      nextOpenET: nextOpen,
      nextOpenLabel: getNextOpenLabel(nextOpen),
    };
  }

  // Regular hours: 9:30 AM - 4:00 PM ET
  if (timeInMinutes >= 570 && timeInMinutes < 960) {
    return {
      isOpen: true,
      label: 'OPEN',
      color: 'text-green-400 bg-green-400/10',
      period: 'open',
      nextOpenET: null,
      nextOpenLabel: 'Market open',
    };
  }

  // After hours: 4:00 PM - 8:00 PM ET
  if (timeInMinutes >= 960 && timeInMinutes < 1200) {
    const nextOpen = getNextOpen();
    return {
      isOpen: false,
      label: 'AFTER HOURS',
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
