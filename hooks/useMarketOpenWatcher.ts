import { useEffect, useRef } from 'react';
import { getBroker } from '@/lib/broker/broker-factory';

/**
 * Checks every minute if the market just opened.
 * When it detects a closed→open transition, fires the callback.
 */
export function useMarketOpenWatcher(onMarketOpen: () => void) {
  const wasOpenRef = useRef<boolean | null>(null);

  useEffect(() => {
    const check = () => {
      const broker = getBroker('demo');
      const isOpen = broker.isMarketOpen();

      // Market just opened (transition from closed to open)
      if (isOpen && wasOpenRef.current === false) {
        console.log('[Market] Just opened — executing pending orders');
        onMarketOpen();
      }
      wasOpenRef.current = isOpen;
    };

    check(); // immediate check on mount
    const interval = setInterval(check, 60000); // every 60 seconds
    return () => clearInterval(interval);
  }, [onMarketOpen]);
}
