// ─── ShareCardModal ──────────────────────────────────────────
// Bottom sheet that previews the StyleShareCard and provides
// share actions: Download PNG, Copy Link, Native Share.
//
// Renders StyleShareCard at full size (390×520) offscreen,
// captures it with html2canvas for download/share as PNG.
//
// All colors via CSS design tokens.

'use client';

import React, { useState, useRef, useCallback } from 'react';
import { StyleShareCard } from './StyleShareCard';
import type { ShareStyleId } from './StyleShareCard';
import type { Level } from '@/lib/theme/tokens';
import { getStyleTrait } from '@/lib/content/investor-styles';

// ─── Props ────────────────────────────────────────────────────

interface ShareCardModalProps {
  open: boolean;
  onClose: () => void;
  styleId: ShareStyleId;
  score: number;
  level: Level;
  riskTolerance: string;
  userName?: string;
}

// ─── Component ───────────────────────────────────────────────

export function ShareCardModal({
  open,
  onClose,
  styleId,
  score,
  level,
  riskTolerance,
  userName,
}: ShareCardModalProps) {
  const [capturing, setCapturing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // ── Capture card as PNG blob ──────────────────────────
  const capturePNG = useCallback(async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(cardRef.current, {
      scale: 2,
      backgroundColor: null,
      useCORS: true,
    });
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png', 0.95);
    });
  }, []);

  // ── Download PNG ──────────────────────────────────────
  async function handleDownload() {
    setCapturing(true);
    try {
      const blob = await capturePNG();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vantage-style-${styleId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast('✅ Downloaded!');
      setTimeout(() => setToast(null), 2000);
    } catch (err) {
      console.error('[ShareCardModal] Capture error:', err);
      setToast('Failed to generate image');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setCapturing(false);
    }
  }

  // ── Build share URL ─────────────────────────────────
  const shareUrl = `https://vantage-ai-trading.vercel.app/share?style=${styleId}${userName ? `&name=${encodeURIComponent(userName)}` : ''}`;

  // ── Copy Link ─────────────────────────────────────────
  function handleCopyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setToast('📋 Link copied!');
      setTimeout(() => setToast(null), 2000);
    }).catch(() => {
      setToast('Failed to copy');
      setTimeout(() => setToast(null), 3000);
    });
  }

  // ── Native Share ──────────────────────────────────────
  async function handleNativeShare() {
    const fullHeadline = getStyleTrait(styleId);
    const shareData: ShareData = {
      title: `I'm ${fullHeadline} on Vantage`,
      text: 'Take the quiz and find out yours →',
      url: shareUrl,
    };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancelled — no-op
      }
    } else {
      // Fallback: try sharing a PNG file
      try {
        setCapturing(true);
        const blob = await capturePNG();
        if (!blob) return;
        const file = new File([blob], `vantage-style-${styleId}.png`, {
          type: 'image/png',
        });
        const fileShareData: ShareData = {
          title: `I'm ${fullHeadline} on Vantage`,
          text: 'Take the quiz and find out yours →',
          files: [file],
        };
        if (navigator.canShare?.(fileShareData)) {
          await navigator.share(fileShareData);
        } else {
          // Last resort: copy link
          handleCopyLink();
        }
      } catch {
        handleCopyLink();
      } finally {
        setCapturing(false);
      }
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          animation: 'vantageFadeIn 0.2s ease-out',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10001,
          maxWidth: '480px',
          margin: '0 auto',
          maxHeight: '90vh',
          background: 'var(--bg-sheet)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-4)',
          animation: 'vantageSheetSlideUp 350ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
      >
        {/* Handle */}
        <div style={{
          width: '36px',
          height: '4px',
          borderRadius: '2px',
          background: 'var(--border-card)',
          flexShrink: 0,
        }} />

        {/* Title */}
        <span style={{
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--text-primary)',
        }}>
          Your Investor Style Card
        </span>
        <span style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginTop: '-12px',
        }}>
          Share your investing identity
        </span>

        {/* Card preview (scaled) */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-primary)',
        }}>
          <div style={{
            transform: 'scale(0.6)',
            transformOrigin: 'top center',
            height: '312px', // 520 * 0.6
          }}>
            <StyleShareCard
              ref={cardRef}
              styleId={styleId}
              score={score}
              level={level}
              riskTolerance={riskTolerance}
            />
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <span style={{
            fontSize: '13px',
            color: 'var(--accent-primary)',
            fontWeight: 600,
          }}>
            {toast}
          </span>
        )}

        {/* Buttons */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-2)',
          width: '100%',
          maxWidth: '360px',
        }}>
          <button
            onClick={handleDownload}
            disabled={capturing}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: capturing ? 'default' : 'pointer',
              opacity: capturing ? 0.5 : 1,
            }}
          >
            {capturing ? 'Rendering…' : 'Download PNG'}
          </button>
          <button
            onClick={handleCopyLink}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Copy Link
          </button>
          <button
            onClick={handleNativeShare}
            disabled={capturing}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--accent-primary)',
              color: '#0a0f1e',
              fontSize: '13px',
              fontWeight: 700,
              cursor: capturing ? 'default' : 'pointer',
              opacity: capturing ? 0.5 : 1,
            }}
          >
            Share
          </button>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes vantageFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes vantageSheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
