// ─── NameCapture ───────────────────────────────────────────
// Appears after Q5. Two required fields (first + last name).
// NO SKIP — this is a required step.
//
// Three-zone flex layout (full viewport):
//   TOP: CompassMark 48px, subtle idleRotate
//   MIDDLE: "One last thing" + two Input fields
//   BOTTOM: CTA button (disabled until both fields filled)

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CompassMark } from '@/components/brand/CompassMark';
import Input from '@/components/ui/Input';
import ScreenTransition from '@/components/layout/ScreenTransition';

interface NameCaptureProps {
  onSubmit: (firstName: string, lastName: string) => void;
}

export function NameCapture({ onSubmit }: NameCaptureProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const lastNameRef = useRef<HTMLInputElement>(null);

  const isValid = firstName.trim().length > 0 && lastName.trim().length > 0;

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit(firstName.trim(), lastName.trim());
  };

  return (
    <ScreenTransition direction="up" transitionKey="name-capture">
      <div
        style={{
          width: '100%',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px',
          paddingTop: 'max(24px, env(safe-area-inset-top, 0px))',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* TOP: CompassMark */}
        <div style={{ marginBottom: 'var(--space-8)' }}>
          <CompassMark size={48} showBurst={false} glow={false} idleRotate />
        </div>

        {/* MIDDLE: content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: '360px' }}>
          <p style={{ fontSize: '16px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: 'var(--space-2)' }}>
            One last thing before your results.
          </p>

          <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center', marginBottom: 'var(--space-8)' }}>
            What should we call you?
          </h2>

          {/* Name fields */}
          <div style={{ display: 'flex', gap: '2%', width: '100%', marginBottom: 'var(--space-4)' }}>
            <div style={{ width: '49%' }}>
              <Input
                placeholder="First name"
                value={firstName}
                onChange={setFirstName}
                autoFocus
              />
            </div>
            <div style={{ width: '49%' }}>
              <Input
                placeholder="Last name"
                value={lastName}
                onChange={setLastName}
              />
            </div>
          </div>
        </div>

        {/* BOTTOM: CTA */}
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <button
            onClick={handleSubmit}
            disabled={!isValid}
            style={{
              width: '100%',
              height: 'var(--height-button)',
              background: isValid ? 'var(--accent)' : 'var(--border-subtle)',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: isValid ? '#000' : 'var(--text-muted)',
              cursor: isValid ? 'pointer' : 'default',
              fontFamily: 'inherit',
              transition: 'all 200ms var(--ease-out)',
              pointerEvents: isValid ? 'auto' : 'none',
            }}
          >
            See my results →
          </button>
        </div>
      </div>
    </ScreenTransition>
  );
}
