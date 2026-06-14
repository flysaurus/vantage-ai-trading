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

  // Calculate next market open (first non-weekend day at 9:30 AM ET)
  function getNextOpen(): Date {
    const next = new Date(etTime);
    next.setHours(9, 30, 0, 0);

    // If past 9:30am or weekend, push to next day
    if (timeInMinutes >= 570 || isWeekend) {
      next.setDate(next.getDate() + 1);
      // Skip weekends
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
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

  // Weekend
  if (day === 0 || day === 6) {
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
