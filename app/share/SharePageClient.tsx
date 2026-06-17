// ─── SharePageClient ────────────────────────────────────────
// Client component for the public share page.
// Renders the standalone investor style result.

'use client';

import { CompassMark } from '@/components/brand/CompassMark';
import { INVESTOR_STYLES, type InvestorStyleKey } from '@/lib/content/investor-styles';

// ─── Props ────────────────────────────────────────────────────

interface SharePageClientProps {
  styleKey: InvestorStyleKey;
  name: string;
}

// ─── Component ───────────────────────────────────────────────

export function SharePageClient({ styleKey, name }: SharePageClientProps) {
  const content = INVESTOR_STYLES[styleKey];
  const displayName = name.trim();

  const sharedStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 10,
    background: '#0a0f1e',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    gap: '16px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#ffffff',
  };

  const headlineStyle: React.CSSProperties = {
    fontSize: '26px',
    fontWeight: 700,
    textAlign: 'center',
    lineHeight: 1.25,
    maxWidth: '320px',
    color: '#ffffff',
  };

  const cyanText: React.CSSProperties = {
    color: '#22d3ee',
  };

  const tagPill: React.CSSProperties = {
    display: 'inline-block',
    padding: '4px 14px',
    borderRadius: '999px',
    border: '1px solid rgba(34, 211, 238, 0.3)',
    background: 'rgba(34, 211, 238, 0.08)',
    fontSize: '13px',
    fontWeight: 600,
    color: '#22d3ee',
    marginTop: '4px',
  };

  const descStyle: React.CSSProperties = {
    fontSize: '16px',
    textAlign: 'center',
    lineHeight: 1.6,
    color: 'rgba(255,255,255,0.82)',
    maxWidth: '340px',
    marginTop: '8px',
  };

  const dividerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '280px',
    height: '1px',
    background: 'rgba(255,255,255,0.1)',
    margin: '16px 0 8px',
  };

  const promptStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    textAlign: 'center',
    color: '#ffffff',
  };

  const ctaStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: '280px',
    padding: '14px 0',
    borderRadius: '12px',
    border: 'none',
    background: '#22d3ee',
    color: '#0a0f1e',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'none',
    marginTop: '4px',
  };

  const footerStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '24px',
  };

  const handleCTA = () => {
    window.location.href = '/';
  };

  return (
    <div style={sharedStyle}>
      {/* Compass mark — small, idle rotating */}
      <div style={{ marginBottom: '4px' }}>
        <CompassMark size={48} idleRotate glow />
      </div>

      {/* Headline */}
      <h1 style={headlineStyle}>
        {displayName ? (
          <>
            <span>{displayName} is </span>
            <span style={cyanText}>{content.fullHeadline}</span>
            <span>.</span>
          </>
        ) : (
          <>
            <span>Someone is </span>
            <span style={cyanText}>{content.fullHeadline}</span>
            <span>.</span>
          </>
        )}
      </h1>

      {/* Tag pill */}
      <span style={tagPill}>{content.tag}</span>

      {/* Description */}
      <p style={descStyle}>{content.description}</p>

      {/* Divider */}
      <div style={dividerStyle} />

      {/* Prompt */}
      <p style={promptStyle}>What&apos;s your investing style?</p>

      {/* CTA */}
      <button style={ctaStyle} onClick={handleCTA}>
        Find my style →
      </button>

      {/* Footer */}
      <span style={footerStyle}>Vantage AI</span>
    </div>
  );
}
