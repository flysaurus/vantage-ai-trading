// ─── NameCapture ───────────────────────────────────────────
// Single-screen name input shown after the quiz questions.
//
// Layout:
// - "What should we call you?" centered
// - Text input with placeholder "First name"
// - "Let's go →" CTA button (cyan)
// - "Skip for now" link below
// - Slide-in animation matching quiz transitions

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
    // Focus input after slide-in animation
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
        padding: '0 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: visible ? 'translateX(0)' : 'translateX(40px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.35s ease, opacity 0.3s ease',
        paddingTop: '60px',
      }}
    >
      {/* Icon */}
      <div style={{ marginBottom: '32px' }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: 'rgba(34, 211, 238, 0.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
          }}
        >
          👋
        </div>
      </div>

      {/* Title */}
      <h2
        style={{
          fontSize: '24px',
          fontWeight: 600,
          color: '#ffffff',
          marginBottom: '8px',
          textAlign: 'center',
        }}
      >
        What should we call you?
      </h2>

      <p
        style={{
          fontSize: '14px',
          color: '#64748b',
          marginBottom: '28px',
          textAlign: 'center',
        }}
      >
        Your AI analyst uses this name.
      </p>

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
          maxWidth: '320px',
          padding: '14px 18px',
          background: '#1a2235',
          border: '1px solid #1e293b',
          borderRadius: '14px',
          fontSize: '16px',
          color: '#ffffff',
          outline: 'none',
          textAlign: 'center',
          transition: 'border-color 0.2s ease',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = '#22d3ee';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = '#1e293b';
        }}
      />

      {/* Let's go button */}
      <button
        onClick={handleSubmit}
        style={{
          width: '100%',
          maxWidth: '320px',
          marginTop: '16px',
          padding: '14px 0',
          background: name.trim() ? '#22d3ee' : '#1e293b',
          border: 'none',
          borderRadius: '14px',
          fontSize: '16px',
          fontWeight: 600,
          color: name.trim() ? '#0a0f1e' : '#64748b',
          cursor: name.trim() ? 'pointer' : 'default',
          transition: 'all 0.2s ease',
        }}
      >
        Let&apos;s go →
      </button>

      {/* Skip */}
      <button
        onClick={onSkip}
        style={{
          background: 'none',
          border: 'none',
          marginTop: '20px',
          fontSize: '14px',
          color: '#64748b',
          cursor: 'pointer',
          padding: '8px',
        }}
      >
        Skip for now
      </button>
    </div>
  );
}
