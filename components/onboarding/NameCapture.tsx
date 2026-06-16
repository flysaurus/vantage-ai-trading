// ─── NameCapture ───────────────────────────────────────────
// Appears after Q5 with slide-up transition.
//
// Layout:
// - Small compass icon (40px, slowly rotating)
// - "One last thing." (18px, muted, centered)
// - "What should we call you?" (26px, white, semibold)
// - Text input (full width, 52px, #1a2235 bg)
// - "Let's go →" CTA (full width, cyan, disabled if empty)
// - "Skip for now" link (13px, muted, centered)

'use client';

import React, { useState, useEffect, useRef } from 'react';

interface NameCaptureProps {
  onSubmit: (name: string) => void;
  onSkip: () => void;
}

export function NameCapture({ onSubmit, onSkip }: NameCaptureProps) {
  const [name, setName] = useState('');
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 16);
    setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    onSubmit(trimmed || '');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div
      style={{
        width: '100%',
        padding: '0 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: visible ? 'translateY(0)' : 'translateY(40px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 320ms ease-in-out, opacity 320ms ease-in-out',
        paddingTop: '40px',
      }}
    >
      {/* Small rotating compass */}
      <div
        className="name-compass-rotate"
        style={{
          width: '40px',
          height: '40px',
          marginBottom: '24px',
          animation: 'slowSpin 8s linear infinite',
        }}
      >
        <svg width="40" height="40" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="#22d3ee" strokeWidth="1.2" opacity="0.3" />
          <line x1="32" y1="4" x2="32" y2="60" stroke="#22d3ee" strokeWidth="1.5" opacity="0.6" />
          <line x1="4" y1="32" x2="60" y2="32" stroke="#22d3ee" strokeWidth="1.5" opacity="0.6" />
          <line x1="12" y1="12" x2="52" y2="52" stroke="#22d3ee" strokeWidth="0.8" opacity="0.25" />
          <line x1="52" y1="12" x2="12" y2="52" stroke="#22d3ee" strokeWidth="0.8" opacity="0.25" />
          <polygon points="32,10 28,18 36,18" fill="#22d3ee" opacity="0.9" />
          <polygon points="32,54 28,46 36,46" fill="#22d3ee" opacity="0.3" />
          <circle cx="32" cy="32" r="2.5" fill="#22d3ee" />
        </svg>
      </div>

      {/* One last thing */}
      <p
        style={{
          fontSize: '18px',
          color: '#64748b',
          marginBottom: '8px',
          textAlign: 'center',
        }}
      >
        One last thing.
      </p>

      {/* What should we call you */}
      <h2
        style={{
          fontSize: '26px',
          fontWeight: 600,
          color: '#ffffff',
          marginBottom: '28px',
          textAlign: 'center',
        }}
      >
        What should we call you?
      </h2>

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="First name"
        autoComplete="given-name"
        maxLength={30}
        style={{
          width: '100%',
          height: '52px',
          padding: '0 16px',
          background: '#1a2235',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '14px',
          fontSize: '16px',
          color: '#ffffff',
          outline: 'none',
          transition: 'border-color 200ms ease',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = '#22d3ee';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
        }}
      />

      {/* Let's go CTA */}
      <button
        onClick={handleSubmit}
        disabled={!name.trim()}
        style={{
          width: '100%',
          marginTop: '16px',
          padding: '15px 0',
          background: name.trim() ? '#22d3ee' : '#1e293b',
          border: 'none',
          borderRadius: '14px',
          fontSize: '16px',
          fontWeight: 600,
          color: name.trim() ? '#0a0f1e' : '#64748b',
          cursor: name.trim() ? 'pointer' : 'default',
          transition: 'all 200ms ease',
        }}
      >
        Let&apos;s go →
      </button>

      {/* Skip for now */}
      <button
        onClick={onSkip}
        style={{
          background: 'none',
          border: 'none',
          marginTop: '12px',
          fontSize: '13px',
          color: '#64748b',
          cursor: 'pointer',
          padding: '8px',
          transition: 'color 150ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#94a3b8';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#64748b';
        }}
      >
        Skip for now
      </button>

      <style>{`
        @keyframes slowSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
