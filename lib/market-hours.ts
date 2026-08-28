// ─── NYSE Holiday Calendar (programmatic) ───────────────────
// Computed at module load for 2025–2050 using the standard NYSE rules
// (mirrors the NYSE official schedule + exchange_calendars conventions).
// No annual maintenance needed — bump NYSE_RANGE_END to cover further years.
//
// FULL-DAY CLOSURES (market closed all day):
//   New Year's Day, MLK Day, Presidents Day, Good Friday, Memorial Day,
//   Juneteenth (June 19), Independence Day (July 4), Labor Day,
//   Thanksgiving, Christmas — all with weekend-observed shifts.
//
// EARLY CLOSE (market closes at 1:00 PM ET, 780 minutes):
//   Day before Independence Day (Jul 3, when Jul 4 is Tue–Fri),
//   Black Friday (day after Thanksgiving), Christmas Eve (Dec 24, weekday).

const NYSE_RANGE_START = 2025;
const NYSE_RANGE_END = 2050;

// Easter Sunday via the Meeus/Jones/Butcher algorithm (for Good Friday).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// nth weekday of a month (weekday: 0=Sun..6=Sat, n: 1-based).
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

// Last weekday of a month (weekday: 0=Sun..6=Sat).
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const off = (new Date(Date.UTC(year, month, last)).getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, last - off));
}

// Saturday → previous Friday; Sunday → following Monday; else unchanged.
function observedHoliday(year: number, month: number, day: number): Date {
  const d = new Date(Date.UTC(year, month, day));
  const wd = d.getUTCDay();
  if (wd === 6) return new Date(Date.UTC(year, month, day - 1));
  if (wd === 0) return new Date(Date.UTC(year, month, day + 1));
  return d;
}

const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

function nyseFullDayHolidays(year: number): Date[] {
  return [
    observedHoliday(year, 0, 1),                    // New Year's Day (observed)
    nthWeekday(year, 0, 1, 3),                      // MLK Jr. Day — 3rd Mon Jan
    nthWeekday(year, 1, 1, 3),                      // Presidents Day — 3rd Mon Feb
    new Date(easterSunday(year).getTime() - 2 * 86400000), // Good Friday
    lastWeekday(year, 4, 1),                        // Memorial Day — last Mon May
    observedHoliday(year, 5, 19),                   // Juneteenth (observed)
    observedHoliday(year, 6, 4),                    // Independence Day (observed)
    nthWeekday(year, 8, 1, 1),                      // Labor Day — 1st Mon Sep
    nthWeekday(year, 10, 4, 4),                     // Thanksgiving — 4th Thu Nov
    observedHoliday(year, 11, 25),                  // Christmas Day (observed)
  ];
}

function nyseEarlyCloses(year: number): Date[] {
  const out: Date[] = [];
  const full = new Set(nyseFullDayHolidays(year).map(fmtDate));
  const isWeekday = (d: Date) => { const w = d.getUTCDay(); return w >= 1 && w <= 5; };
  // Black Friday (day after Thanksgiving)
  out.push(new Date(nthWeekday(year, 10, 4, 4).getTime() + 86400000));
  // Christmas Eve (weekday, not a full holiday)
  const xmasEve = new Date(Date.UTC(year, 11, 24));
  if (isWeekday(xmasEve) && !full.has(fmtDate(xmasEve))) out.push(xmasEve);
  // Day before Independence Day (Jul 3 when Jul 4 is Tue–Fri)
  const july4Dow = new Date(Date.UTC(year, 6, 4)).getUTCDay();
  if (july4Dow >= 2 && july4Dow <= 5) {
    const july3 = new Date(Date.UTC(year, 6, 3));
    if (isWeekday(july3) && !full.has(fmtDate(july3))) out.push(july3);
  }
  return out;
}

const NYSE_HOLIDAYS = new Set<string>();
const NYSE_EARLY_CLOSE = new Set<string>();
for (let y = NYSE_RANGE_START; y <= NYSE_RANGE_END; y++) {
  for (const d of nyseFullDayHolidays(y)) NYSE_HOLIDAYS.add(fmtDate(d));
  for (const d of nyseEarlyCloses(y)) NYSE_EARLY_CLOSE.add(fmtDate(d));
}

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

// ─── Trading-day calendar helpers ───────────────────────────
// Used by the DCA scheduler to skip weekends and full-day NYSE
// holidays (early-close days are still trading days — the market
// opens 9:30 ET, so a market order still fills that morning).

function etDateParts(date: Date): { dateStr: string; weekday: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
  };
}

// True if `date` is a full trading day (Mon–Fri and not a full-day NYSE holiday).
export function isTradingDay(date: Date): boolean {
  const { dateStr, weekday } = etDateParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return !NYSE_HOLIDAYS.has(dateStr);
}

// Next full trading day strictly after `date`.
export function nextTradingDay(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  let safety = 0;
  while (!isTradingDay(next) && safety < 30) {
    next.setDate(next.getDate() + 1);
    safety++;
  }
  return next;
}
