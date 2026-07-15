import { useEffect, useRef } from 'react';
import { getBroker } from '@/lib/broker/broker-factory';

/**
 * Checks every minute if the market just opened.
 * When it detects a closed→open transition, fires the callback.
 */
export function useMarketOpenWatcher(onMarketOpen: () => void) {
  const hasFiredRef = useRef(false);

  useEffect(() => {
    const check = () => {
      const broker = getBroker('demo');
      const isOpen = broker.isMarketOpen();

      // Fire if market is open and we haven't fired since last closed→open transition.
      // Also fires on mount if market is already open (hasFiredRef starts false).
      if (isOpen && !hasFiredRef.current) {
        console.log('[Market] Market is open — executing pending orders');
        hasFiredRef.current = true;
        onMarketOpen();
      }

      // Reset flag when market closes so next open triggers again
      if (!isOpen) {
        hasFiredRef.current = false;
      }
    };

    check(); // immediate check on mount
    const interval = setInterval(check, 60000); // every 60 seconds
    return () => clearInterval(interval);
  }, [onMarketOpen]);
}
