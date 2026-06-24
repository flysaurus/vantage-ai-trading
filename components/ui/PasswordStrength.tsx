'use client';

import React from 'react';
import { CheckCircle, Circle } from 'lucide-react';

interface PasswordStrengthProps {
  password: string;
}

const requirements = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[!@#$%^&*]/.test(p) },
];

function getStrengthLevel(met: number): { label: string; color: string } {
  if (met <= 1) return { label: 'Weak', color: 'var(--strength-weak)' };
  if (met === 2) return { label: 'Fair', color: 'var(--strength-fair)' };
  if (met <= 4) return { label: 'Good', color: 'var(--strength-good)' };
  return { label: 'Strong', color: 'var(--strength-strong)' };
}

export default function PasswordStrength({ password }: PasswordStrengthProps) {
  const met = requirements.filter((r) => r.test(password)).length;
  const pct = (met / 5) * 100;
  const { label, color } = getStrengthLevel(met);

  if (!password) return null;

  return (
    <div style={{ width: '100%' }}>
      {/* Strength meter */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div
          style={{
            flex: 1,
            height: '4px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--border-subtle)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 'var(--radius-pill)',
              background: color,
              transition: `width var(--duration-base) var(--ease-out), background var(--duration-base) var(--ease-out)`,
            }}
          />
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color,
            minWidth: '40px',
            textAlign: 'right',
            transition: `color var(--duration-base) var(--ease-out)`,
          }}
        >
          {label}
        </span>
      </div>

      {/* Requirement rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {requirements.map((req, i) => {
          const isMet = req.test(password);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}
            >
              {isMet ? (
                <CheckCircle
                  size={14}
                  color="var(--gain)"
                  style={{
                    flexShrink: 0,
                    animation: `requirementPop 200ms var(--ease-spring)`,
                  }}
                />
              ) : (
                <Circle
                  size={14}
                  color="var(--text-muted)"
                  style={{ flexShrink: 0 }}
                />
              )}
              <span
                style={{
                  fontSize: '13px',
                  color: isMet ? 'var(--text-primary)' : 'var(--text-muted)',
                  transition: `color var(--duration-fast) var(--ease-out)`,
                }}
              >
                {req.label}
              </span>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes requirementPop {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
