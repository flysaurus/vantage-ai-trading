// ─── ShareCardModal ──────────────────────────────────────────
// Bottom sheet that previews the StyleShareCard and provides
// share actions: Download PNG, Copy Link, Native Share.
//
// Renders StyleShareCard at full size (390×520) offscreen,
// captures it with html2canvas for download/share as PNG.
//
// All colors via CSS design tokens.

'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

  // ── Lock body scroll when modal is open ───────────────
  useEffect(() => {
    if (open) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [open]);

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
    const STYLE_NAMES: Record<string, string> = {
      lynch: 'Peter Lynch', buffett: 'Warren Buffett',
      livermore: 'Jesse Livermore', munger: 'Charlie Munger',
      soros: 'George Soros',
    };
    const styleName = STYLE_NAMES[styleId] || fullHeadline;
    const shareData: ShareData = {
      title: `I'm a ${fullHeadline} on Vantage 📈`,
      text: `Vantage matched my investing personality to ${styleName}. An AI advisor that thinks like you — your strategy, your style. 2-min quiz →`,
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
          title: `I'm a ${fullHeadline} on Vantage 📈`,
          text: `Vantage matched my investing personality to ${styleName}. An AI advisor that thinks like you — your strategy, your style. 2-min quiz →`,
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

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99998,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          animation: 'vantageFadeIn 0.2s ease-out',
        }}
      />

      {/* Sheet — sits ABOVE the bottom nav (64px) + safe-area, not at bottom:0 */}
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
          left: 0,
          right: 0,
          zIndex: 99999,
          maxWidth: '480px',
          margin: '0 auto',
          maxHeight: 'calc(100vh - 64px - env(safe-area-inset-bottom, 0px) - 16px)',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          background: 'var(--bg-sheet)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          padding: '12px 16px calc(16px + env(safe-area-inset-bottom, 0px))',
          textAlign: 'center',
          animation: 'vantageSheetSlideUp 350ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        }}
      >
        {/* Handle */}
        <div style={{
          width: '36px',
          height: '4px',
          borderRadius: '2px',
          background: 'var(--border-card)',
          margin: '0 auto 12px',
        }} />

        {/* Title */}
        <div style={{
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: '4px',
        }}>
          Your Investor Style Card
        </div>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '16px',
        }}>
          Share your investing identity
        </div>

        {/* Card preview (scaled) */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: '12px',
          background: 'var(--bg-primary)',
          marginBottom: '12px',
        }}>
          <div style={{
            transform: 'scale(0.6)',
            transformOrigin: 'top center',
            height: '312px',
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
          <div style={{
            fontSize: '13px',
            color: 'var(--accent-primary)',
            fontWeight: 600,
            marginBottom: '12px',
          }}>
            {toast}
          </div>
        )}

        {/* Buttons */}
        <div style={{
          display: 'flex',
          gap: '8px',
          width: '100%',
          maxWidth: '360px',
          margin: '0 auto',
          paddingBottom: '8px',
        }}>
          <button
            onClick={handleDownload}
            disabled={capturing}
            style={{
              flex: 1,
              padding: '12px 4px',
              borderRadius: '10px',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: capturing ? 'default' : 'pointer',
              opacity: capturing ? 0.5 : 1,
            }}
          >
            {capturing ? 'Rendering…' : 'Download'}
          </button>
          <button
            onClick={handleCopyLink}
            style={{
              flex: 1,
              padding: '12px 4px',
              borderRadius: '10px',
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
              padding: '12px 4px',
              borderRadius: '10px',
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
    </>,
    document.body
  );
}
