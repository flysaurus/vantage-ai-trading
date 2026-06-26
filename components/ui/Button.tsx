'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps {
  label: string;
  onClick?: () => void;
  variant: 'primary' | 'secondary' | 'ghost' | 'google';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export default function Button({
  label,
  onClick,
  variant,
  disabled = false,
  loading = false,
  fullWidth = false,
  size = 'md',
  icon,
}: ButtonProps) {
  const height = size === 'sm' ? 'var(--height-button-sm)' : 'var(--height-button)';
  const isDisabled = disabled || loading;

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    height,
    width: fullWidth ? '100%' : undefined,
    borderRadius: 'var(--radius-button)',
    fontSize: size === 'sm' ? 'var(--text-sm)' : 'var(--text-sm)',
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    border: 'none',
    outline: 'none',
    transition: `opacity var(--duration-fast), transform var(--duration-fast)`,
    opacity: isDisabled ? 0.4 : 1,
    pointerEvents: isDisabled ? 'none' : undefined,
    paddingLeft: 'var(--space-5)',
    paddingRight: 'var(--space-5)',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none' as const,
  };

  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      background: 'var(--accent)',
      color: '#000000',
    },
    secondary: {
      background: 'transparent',
      border: '1px solid var(--border-accent)',
      color: 'var(--accent)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-secondary)',
    },
    google: {
      background: 'transparent',
      border: '1px solid var(--border-card)',
      color: 'var(--text-primary)',
    },
  };

  const handlePress = (e: React.MouseEvent | React.TouchEvent) => {
    if (isDisabled) return;
    const target = e.currentTarget as HTMLElement;
    target.style.transform = 'scale(0.98)';
    target.style.opacity = '0.9';
    target.style.transitionDuration = 'var(--duration-fast)';
    setTimeout(() => {
      target.style.transform = 'scale(1)';
      target.style.opacity = '1';
    }, 150);
  };

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      onMouseDown={handlePress}
      onTouchStart={handlePress}
      style={{ ...baseStyle, ...variantStyles[variant] }}
    >
      {loading ? (
        <Loader2
          size={20}
          style={{
            animation: 'spin 0.7s linear infinite',
          }}
        />
      ) : variant === 'google' && !icon ? (
        <>
          <GoogleLogo />
          {label}
        </>
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </button>
  );
}

/** Inline Google "G" logo – the only non-Lucide icon allowed per spec */
function GoogleLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
