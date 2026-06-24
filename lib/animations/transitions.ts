/**
 * ═══════════════════════════════════════════════════════════
 * VANTAGE TRANSITION SYSTEM — Single Source of Truth
 * Every screen-level animation in the app must use one of
 * these five patterns. No ad hoc transitions, no Framer Motion.
 * ═══════════════════════════════════════════════════════════
 *
 * These are consumed by ScreenTransition and optionally
 * used inline for one-off microinteractions.
 * All values reference CSS custom properties defined in
 * app/globals.css (--duration-*, --ease-*).
 */

export type TransitionName = 'slideUp' | 'slideLeft' | 'slideRight' | 'fade' | 'slideDown';

export interface TransitionPhase {
  transform?: string;
  opacity?: number;
  transition?: string;
}

export interface TransitionDef {
  initial: TransitionPhase;
  animate: TransitionPhase;
  exit: TransitionPhase;
}

export const transitions: Record<TransitionName, TransitionDef> = {
  /* ── Sheet / modal / screen entering from bottom ── */
  slideUp: {
    initial: {
      transform: 'translateY(100%)',
      opacity: 0,
    },
    animate: {
      transform: 'translateY(0)',
      opacity: 1,
      transition: 'transform var(--duration-base) var(--ease-spring), opacity var(--duration-fast) var(--ease-out)',
    },
    exit: {
      transform: 'translateY(100%)',
      opacity: 0,
      transition: 'transform var(--duration-base) var(--ease-in), opacity var(--duration-fast) var(--ease-in)',
    },
  },

  /* ── Forward navigation (new screen enters from right) ── */
  slideLeft: {
    exit: {
      transform: 'translateX(-30px)',
      opacity: 0,
      transition: 'all var(--duration-base) var(--ease-in)',
    },
    initial: {
      transform: 'translateX(30px)',
      opacity: 0,
    },
    animate: {
      transform: 'translateX(0)',
      opacity: 1,
      transition: 'all var(--duration-base) var(--ease-out)',
    },
  },

  /* ── Back navigation (screen enters from left) ── */
  slideRight: {
    exit: {
      transform: 'translateX(30px)',
      opacity: 0,
      transition: 'all var(--duration-base) var(--ease-in)',
    },
    initial: {
      transform: 'translateX(-30px)',
      opacity: 0,
    },
    animate: {
      transform: 'translateX(0)',
      opacity: 1,
      transition: 'all var(--duration-base) var(--ease-out)',
    },
  },

  /* ── Overlays, toasts, banners ── */
  fade: {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: 'opacity var(--duration-base) var(--ease-out)',
    },
    exit: {
      opacity: 0,
      transition: 'opacity var(--duration-fast) var(--ease-in)',
    },
  },

  /* ── Toast from top ── */
  slideDown: {
    initial: {
      transform: 'translateY(-100%)',
      opacity: 0,
    },
    animate: {
      transform: 'translateY(0)',
      opacity: 1,
      transition: 'transform var(--duration-base) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
    },
    exit: {
      transform: 'translateY(-100%)',
      opacity: 0,
      transition: 'transform var(--duration-base) var(--ease-in), opacity var(--duration-fast) var(--ease-in)',
    },
  },
};

/* ── Micro-interaction helpers (one-shot, not ScreenTransition) ── */

export const pop = {
  /** Scale up momentarily (e.g., milestone unlock) */
  animate: {
    transform: 'scale(1.12)',
    transition: 'transform 100ms var(--ease-spring)',
  },
  /** Settle back to natural size */
  settle: {
    transform: 'scale(1)',
    transition: 'transform 200ms var(--ease-out)',
  },
} as const;
