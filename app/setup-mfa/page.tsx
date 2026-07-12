'use client';

// ─── MFA Setup Page ──────────────────────────────────────────
// Mandatory 2FA setup after email verification.
//
// Flow:
//  1. Choose method: TOTP (authenticator app) or Email OTP
//  2. TOTP: Show QR code → user scans → enters code → backup codes shown
//  3. Email OTP: Instant — just confirms and redirects
//  4. Backup codes: Displayed once, user must acknowledge

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield, Smartphone, Mail, Copy, Check, ArrowRight, QrCode } from 'lucide-react';
import QRCode from 'qrcode';

type SetupStep = 'choose' | 'totp-scan' | 'totp-confirm' | 'backup-codes' | 'done';

export default function SetupMfaPage() {
  const router = useRouter();

  const [step, setStep] = useState<SetupStep>('choose');
  const [method, setMethod] = useState<'totp' | 'email' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TOTP state
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Backup codes
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  // ── Choose Email OTP ──────────────────────────────────
  const handleChooseEmail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/choose-method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'email' }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push('/you-are-in');
      } else {
        setError(data.error || 'Failed to set up email verification');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  // ── Choose TOTP → generate secret + QR ──────────────
  const handleChooseTotp = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMethod('totp');
    try {
      const res = await fetch('/api/auth/mfa/setup-totp', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        // Generate QR code data URL
        const qrUrl = await QRCode.toDataURL(data.otpauthUrl, {
          width: 240,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setQrDataUrl(qrUrl);
        setManualKey(data.manualKey);
        setStep('totp-scan');
      } else {
        setError(data.error || 'Failed to generate TOTP secret');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Confirm TOTP ─────────────────────────────────────
  const handleConfirmTotp = useCallback(async () => {
    if (totpCode.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/confirm-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = await res.json();
      if (res.ok) {
        setBackupCodes(data.backupCodes);
        setStep('backup-codes');
      } else {
        setError(data.error || 'Verification failed');
        setTotpCode('');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [totpCode]);

  // ── Copy key ─────────────────────────────────────────
  const handleCopyKey = () => {
    if (manualKey) {
      navigator.clipboard.writeText(manualKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Done ─────────────────────────────────────────────
  const handleDone = () => {
    router.push('/you-are-in');
  };

  // ── Styles ───────────────────────────────────────────
  const pageStyle: React.CSSProperties = {
    minHeight: '100dvh',
    background: 'linear-gradient(180deg, #0b0f1d 0%, #131a2e 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    padding: '60px 24px 40px',
  };

  const cardStyle: React.CSSProperties = {
    background: '#1a1f35',
    border: '1px solid #2d3550',
    borderRadius: '14px',
    padding: '24px',
    width: '100%',
    maxWidth: '400px',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    background: '#06b6d4',
    color: '#0a0f1e',
    border: 'none',
    borderRadius: '10px',
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
  };

  const codeInputStyle: React.CSSProperties = {
    width: '100%',
    background: '#0f1324',
    border: '1px solid #2d3550',
    borderRadius: '10px',
    padding: '18px 16px',
    color: '#f8fafc',
    fontSize: '32px',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    letterSpacing: '12px',
    textAlign: 'center',
    outline: 'none',
    boxSizing: 'border-box',
    maxWidth: '280px',
  };

  // ── RENDER: Choose method ────────────────────────────
  if (step === 'choose') {
    return (
      <div style={pageStyle}>
        <Shield size={48} color="#06b6d4" style={{ marginBottom: '24px' }} />
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px', color: '#f8fafc', textAlign: 'center' }}>
          Secure your account
        </h1>
        <p style={{ fontSize: '14px', color: '#94a3b8', textAlign: 'center', margin: '0 0 32px', lineHeight: 1.6, maxWidth: '360px' }}>
          Choose how you want to verify your identity when signing in.
        </p>

        {/* TOTP option */}
        <div
          style={{ ...cardStyle, marginBottom: '16px' }}
          onClick={handleChooseTotp}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              background: 'rgba(6,182,212,0.15)',
              borderRadius: '10px',
              padding: '12px',
            }}>
              <Smartphone size={28} color="#06b6d4" />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px', color: '#f8fafc' }}>
                Authenticator app
              </h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                Use Google Authenticator, Authy, or any TOTP app
              </p>
            </div>
            <ArrowRight size={18} color="#06b6d4" />
          </div>
        </div>

        {/* Email OTP option */}
        <div
          style={{ ...cardStyle }}
          onClick={handleChooseEmail}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              background: 'rgba(6,182,212,0.15)',
              borderRadius: '10px',
              padding: '12px',
            }}>
              <Mail size={28} color="#06b6d4" />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px', color: '#f8fafc' }}>
                Email code
              </h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                Receive a 6-digit code by email each time you sign in
              </p>
            </div>
            <ArrowRight size={18} color="#06b6d4" />
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <Loader2 size={24} color="#06b6d4" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        {error && (
          <div style={{
            marginTop: '16px',
            background: 'rgba(218,54,51,0.1)',
            border: '1px solid #da3633',
            borderRadius: '10px',
            padding: '12px 16px',
            color: '#e6edf3',
            fontSize: '13px',
            textAlign: 'center',
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── RENDER: TOTP scan QR ─────────────────────────────
  if (step === 'totp-scan') {
    return (
      <div style={pageStyle}>
        <QrCode size={48} color="#06b6d4" style={{ marginBottom: '24px' }} />
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px', color: '#f8fafc', textAlign: 'center' }}>
          Scan the QR code
        </h1>
        <p style={{ fontSize: '14px', color: '#94a3b8', textAlign: 'center', margin: '0 0 24px', lineHeight: 1.6, maxWidth: '360px' }}>
          Open your authenticator app and scan this QR code to add your Vantage account.
        </p>

        {/* QR Code */}
        {qrDataUrl && (
          <div style={{
            background: '#ffffff',
            borderRadius: '14px',
            padding: '20px',
            marginBottom: '24px',
          }}>
            <img src={qrDataUrl} alt="TOTP QR Code" style={{ display: 'block', width: '240px', height: '240px' }} />
          </div>
        )}

        {/* Manual key */}
        <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 8px' }}>
          Or enter this key manually:
        </p>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#0f1324',
          border: '1px solid #2d3550',
          borderRadius: '10px',
          padding: '10px 14px',
          maxWidth: '380px',
        }}>
          <code style={{
            fontSize: '13px',
            color: '#f8fafc',
            fontFamily: "'SF Mono', monospace",
            wordBreak: 'break-all',
            flex: 1,
          }}>
            {manualKey}
          </code>
          <button onClick={handleCopyKey} style={{
            background: 'none',
            border: 'none',
            color: '#06b6d4',
            cursor: 'pointer',
            padding: '4px',
          }}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>

        <p style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', margin: '24px 0 8px' }}>
          After scanning, enter the 6-digit code from your app to confirm:
        </p>

        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={totpCode}
          onChange={(e) => {
            setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            if (error) setError(null);
          }}
          placeholder="000000"
          style={codeInputStyle}
          disabled={loading}
        />

        <button
          style={{
            ...buttonStyle,
            maxWidth: '280px',
            marginTop: '16px',
            opacity: totpCode.length === 6 && !loading ? 1 : 0.5,
            cursor: totpCode.length === 6 && !loading ? 'pointer' : 'not-allowed',
          }}
          disabled={totpCode.length !== 6 || loading}
          onClick={handleConfirmTotp}
        >
          {loading ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              Verifying...
            </span>
          ) : 'Verify and enable'}
        </button>

        {error && (
          <div style={{
            marginTop: '16px',
            background: 'rgba(218,54,51,0.1)',
            border: '1px solid #da3633',
            borderRadius: '10px',
            padding: '12px 16px',
            color: '#e6edf3',
            fontSize: '13px',
            textAlign: 'center',
            maxWidth: '280px',
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── RENDER: Backup codes ─────────────────────────────
  if (step === 'backup-codes') {
    return (
      <div style={pageStyle}>
        <Shield size={48} color="#22c55e" style={{ marginBottom: '24px' }} />
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px', color: '#f8fafc', textAlign: 'center' }}>
          Save your backup codes
        </h1>
        <p style={{ fontSize: '14px', color: '#94a3b8', textAlign: 'center', margin: '0 0 24px', lineHeight: 1.6, maxWidth: '360px' }}>
          If you lose access to your authenticator app, use one of these codes to sign in.
          Each code can only be used once.
        </p>

        {/* Backup codes grid */}
        <div style={{
          background: '#0f1324',
          border: '1px solid #22c55e',
          borderRadius: '14px',
          padding: '24px',
          width: '100%',
          maxWidth: '400px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginBottom: '24px',
        }}>
          {backupCodes.map((code, i) => (
            <div key={i} style={{
              fontFamily: "'SF Mono', monospace",
              fontSize: '14px',
              color: '#22c55e',
              background: 'rgba(34,197,94,0.08)',
              borderRadius: '6px',
              padding: '8px 10px',
              textAlign: 'center',
              letterSpacing: '1px',
            }}>
              {code}
            </div>
          ))}
        </div>

        {/* Acknowledge checkbox */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '16px',
          cursor: 'pointer',
          maxWidth: '400px',
        }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ accentColor: '#06b6d4', width: '18px', height: '18px' }}
          />
          <span style={{ fontSize: '13px', color: '#94a3b8' }}>
            I have saved these backup codes securely. I understand they will not be shown again.
          </span>
        </label>

        <button
          style={{
            ...buttonStyle,
            opacity: acknowledged ? 1 : 0.5,
            cursor: acknowledged ? 'pointer' : 'not-allowed',
          }}
          disabled={!acknowledged}
          onClick={handleDone}
        >
          Continue to Vantage
        </button>
      </div>
    );
  }

  return null;
}
