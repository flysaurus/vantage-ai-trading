'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { TabId } from '@/store';

interface BackButtonProps {
  /** Target tab to navigate back to */
  tab: TabId;
  /** Optional label text (defaults to "Back to {tab}") */
  label?: string;
  /** Icon size in px (default 14) */
  iconSize?: number;
  /** Optional inline styles */
  style?: React.CSSProperties;
  /** Optional className */
  className?: string;
  /** Render as text link with icon (false = icon-only button) */
  showLabel?: boolean;
  /** Custom icon element (defaults to ArrowLeft) */
  icon?: React.ReactNode;
  /** Custom children — overrides built-in icon+label rendering entirely */
  children?: React.ReactNode;
}

const TAB_LABELS: Record<TabId, string> = {
  ai: 'AI',
  invest: 'Invest',
  portfolio: 'Portfolio',
  watchlist: 'Watchlist',
  settings: 'Settings',
};

/**
 * Shared back button that navigates to a tab via query param.
 * Standardizes the `router.push('/?tab=X')` pattern across all sub-pages.
 * 
 * Usage:
 *   <BackButton tab="settings" />           // icon-only
 *   <BackButton tab="settings" showLabel />  // "← Back to Settings"
 */
export default function BackButton({
  tab,
  label,
  iconSize = 14,
  style,
  className,
  showLabel = false,
  icon,
  children,
}: BackButtonProps) {
  const router = useRouter();
  const displayLabel = label ?? `Back to ${TAB_LABELS[tab]}`;

  return (
    <button
      onClick={() => router.push(`/?tab=${tab}`)}
      aria-label={displayLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: showLabel || children ? 4 : 0,
        background: 'none',
        border: 'none',
        color: 'var(--text-muted, #94a3b8)',
        cursor: 'pointer',
        padding: children ? undefined : 4,
        ...style,
      }}
      className={className}
    >
      {children ?? (
        <>
          {icon ?? <ArrowLeft size={iconSize} />}
          {showLabel && (
            <span style={{ fontSize: 12, fontWeight: 500 }}>{displayLabel}</span>
          )}
        </>
      )}
    </button>
  );
}

export { TAB_LABELS };
