'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { debugLog } from '@/lib/debug-log';

interface PendingAction {
  type: 'basket' | 'trade' | 'chat';
  payload?: any;
}

interface EmailGateContextValue {
  gate: (action: PendingAction) => boolean;
  showEmailGate: boolean;
  pendingAction: PendingAction | null;
  close: () => void;
}

const EmailGateContext = createContext<EmailGateContextValue>({
  gate: () => true,
  showEmailGate: false,
  pendingAction: null,
  close: () => {},
});

export function EmailGateProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isDataLoaded } = useAuth();
  const [showEmailGate, setShowEmailGate] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const gate = useCallback((action: PendingAction): boolean => {
    debugLog('EmailGate evaluated', `isAuthenticated: ${isAuthenticated}, isDataLoaded: ${isDataLoaded}, action: ${action.type}`);
    // If auth data hasn't loaded yet, block silently (don't show modal).
    // This prevents false triggers during the post-redirect loading window.
    // The caller should retry after isDataLoaded becomes true.
    if (!isDataLoaded) {
      debugLog('EmailGate DEFER', 'Auth data not loaded yet — blocking silently');
      return false;
    }
    if (isAuthenticated) {
      debugLog('EmailGate PASS', `Allowing action: ${action.type}`);
      return true;
    }
    debugLog('EmailGate BLOCKED', `Showing modal for action: ${action.type}`);
    setPendingAction(action);
    setShowEmailGate(true);
    return false;
  }, [isAuthenticated, isDataLoaded]);

  const close = useCallback(() => {
    setShowEmailGate(false);
  }, []);

  return React.createElement(EmailGateContext.Provider, {
    value: { gate, showEmailGate, pendingAction, close }
  }, children);
}

export function useEmailGate(): EmailGateContextValue {
  return useContext(EmailGateContext);
}
