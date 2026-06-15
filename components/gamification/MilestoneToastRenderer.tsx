// ─── MilestoneToastRenderer ──────────────────────────────────
// Renders the current milestone toast from MilestoneContext.
// Mounted once in layout.tsx, persists across page navigations.

'use client';

import React from 'react';
import { useMilestoneToast } from '@/context/MilestoneContext';
import { MilestoneToast } from '@/components/gamification/MilestoneToast';

export function MilestoneToastRenderer() {
  const { currentToast, dismissCurrent } = useMilestoneToast();

  if (!currentToast) return null;

  return (
    <MilestoneToast
      toast={currentToast}
      onDismiss={dismissCurrent}
    />
  );
}
