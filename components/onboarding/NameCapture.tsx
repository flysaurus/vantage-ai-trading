// ─── NameCapture ───────────────────────────────────────────
// Full redesign: stacked inputs, white pill Continue,
// two-line headline, bg-onboarding-name gradient.
//
// Layout:
//   TOP BAR:    Back (left) + VantageMark (center)
//   HEADLINE:   two-line sans+serif system
//   NARRATOR:   Vantage AI brand line
//   FIELDS:     stacked first + last name inputs
//   CONTINUE:   white pill, disabled until both filled

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

interface NameCaptureProps {
  onSubmit: (firstName: string, lastName: string) => void;
  onBack: () => void;
}

export function NameCapture({ onSubmit, onBack }: NameCaptureProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [entering, setEntering] = useState(false);
  const firstNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntering(true));
      // Autofocus first name input
      setTimeout(() => firstNameRef.current?.focus(), 350);
    });
  }, []);

  const isValid = firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <div
      className="bg-onboarding-name"
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        transition: 'opacity 300ms var(--ease-out), transform 300ms var(--ease-out)',
        opacity: entering ? 1 : 0,
        transform: entering ? 'translateX(0)' : 'translateX(100%)',
      }}
    >
      {/* ── TOP BAR ── */}
      <div
        style={{
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          position: 'relative',
          flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: '15px',
            cursor: 'pointer',
            padding: '8px 12px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'inherit',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <ChevronLeft size={20} />
          Back
        </button>

        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <VantageOrb size={44} animate showEntrance={false} />
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 24px',
          maxWidth: '400px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Two-line headline */}
        <h2 style={{ marginBottom: '24px', textAlign: 'center' }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '38px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            What should we
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '38px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            call you?
          </span>
        </h2>

        {/* Narrator line */}
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            fontWeight: 400,
            lineHeight: 1.5,
            margin: '0 0 24px',
          }}
        >
          We'll use your name to personalize everything — your greeting, your AI advisor, your reports.
        </p>

        {/* Stacked inputs */}
        <input
          ref={firstNameRef}
          type="text"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoFocus
          style={{
            width: '100%',
            height: '56px',
            padding: '0 18px',
            marginBottom: '12px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '14px',
            fontSize: '17px',
            fontWeight: 500,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
            transition: 'border-color 200ms var(--ease-out), background 200ms var(--ease-out)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.border = '1px solid var(--accent)';
            e.currentTarget.style.background = 'rgba(34,211,238,0.05)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.10)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
          }}
        />

        <input
          type="text"
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          style={{
            width: '100%',
            height: '56px',
            padding: '0 18px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '14px',
            fontSize: '17px',
            fontWeight: 500,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
            transition: 'border-color 200ms var(--ease-out), background 200ms var(--ease-out)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.border = '1px solid var(--accent)';
            e.currentTarget.style.background = 'rgba(34,211,238,0.05)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.10)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
          }}
        />

        {/* Continue button */}
        <button
          onClick={() => isValid && onSubmit(firstName.trim(), lastName.trim())}
          disabled={!isValid}
          style={{
            width: '100%',
            height: '56px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: isValid ? '#ffffff' : 'rgba(255,255,255,0.20)',
            color: isValid ? '#000000' : 'rgba(0,0,0,0.40)',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: isValid ? 'pointer' : 'default',
            pointerEvents: isValid ? 'auto' : 'none',
            marginTop: '24px',
            transition: 'background 200ms var(--ease-out), color 200ms var(--ease-out)',
          }}
          onTouchStart={(e) => {
            if (!isValid) return;
            (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)';
          }}
          onTouchEnd={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
          }}
        >
          See my results
        </button>
      </div>
    </div>
  );
}
