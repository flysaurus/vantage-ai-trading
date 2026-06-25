'use client';

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface InputProps {
  label?: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  showToggle?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
}

export default function Input({
  label,
  placeholder,
  type = 'text',
  value,
  onChange,
  error,
  hint,
  showToggle = false,
  autoFocus = false,
  disabled = false,
  onBlur,
}: InputProps) {
  const [visible, setVisible] = useState(false);
  const inputType = showToggle && !visible ? 'password' : type === 'password' && !showToggle ? 'password' : type;

  return (
    <div style={{ width: '100%' }}>
      {label && (
        <label
          style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: '6px',
            fontWeight: 500,
          }}
        >
          {label}
        </label>
      )}

      <div
        style={{
          position: 'relative',
          height: 'var(--height-input)',
        }}
      >
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          style={{
            width: '100%',
            height: 'var(--height-input)',
            background: 'var(--bg-input)',
            border: error
              ? '1px solid var(--loss)'
              : '1px solid var(--border-input)',
            borderRadius: 'var(--radius-input)',
            padding: showToggle ? '0 48px 0 16px' : '0 16px',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'inherit',
            outline: 'none',
            transition: `border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)`,
            boxShadow: error
              ? '0 0 0 3px var(--loss-10)'
              : 'none',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'text',
          }}
          onFocus={(e) => {
            if (!error) {
              e.target.style.borderColor = 'var(--border-input-focus)';
              e.target.style.boxShadow = '0 0 0 3px var(--accent-10)';
            }
          }}
          onBlur={(e) => {
            if (!error) {
              e.target.style.borderColor = 'var(--border-input)';
              e.target.style.boxShadow = 'none';
            }
            onBlur?.();
          }}
        />

        {showToggle && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            tabIndex={-1}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        )}
      </div>

      {error && (
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--loss)',
            marginTop: '6px',
            animation: `fadeIn var(--duration-fast) var(--ease-out)`,
          }}
        >
          {error}
        </p>
      )}

      {hint && !error && (
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            marginTop: '6px',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
