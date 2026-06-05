export function isMarketOpen(): boolean {
  const now = new Date();

  // Convert to Eastern Time
  const etTime = new Date(
    now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
    })
  );

  const day = etTime.getDay(); // 0=Sun, 6=Sat
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Weekend = closed
  if (day === 0 || day === 6) return false;

  // Regular hours: 9:30 AM - 4:00 PM ET
  const marketOpen = 9 * 60 + 30; // 570 minutes
  const marketClose = 16 * 60; // 960 minutes

  return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
}

export function getMarketStatus(): {
  isOpen: boolean;
  label: string;
  color: string;
} {
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

  // Weekend
  if (day === 0 || day === 6) {
    return {
      isOpen: false,
      label: 'CLOSED',
      color: 'text-red-400 bg-red-400/10',
    };
  }

  // Pre-market: 4:00 AM - 9:30 AM ET
  if (timeInMinutes >= 240 && timeInMinutes < 570) {
    return {
      isOpen: false,
      label: 'PRE-MARKET',
      color: 'text-yellow-400 bg-yellow-400/10',
    };
  }

  // Regular hours: 9:30 AM - 4:00 PM ET
  if (timeInMinutes >= 570 && timeInMinutes < 960) {
    return {
      isOpen: true,
      label: 'OPEN',
      color: 'text-green-400 bg-green-400/10',
    };
  }

  // After hours: 4:00 PM - 8:00 PM ET
  if (timeInMinutes >= 960 && timeInMinutes < 1200) {
    return {
      isOpen: false,
      label: 'AFTER HOURS',
      color: 'text-yellow-400 bg-yellow-400/10',
    };
  }

  // Closed
  return {
    isOpen: false,
    label: 'CLOSED',
    color: 'text-red-400 bg-red-400/10',
  };
}
