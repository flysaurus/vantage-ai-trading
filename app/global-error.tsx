'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Global Error Boundary]', error);
  }, [error]);

  // ChunkLoadError: the chunk file doesn't exist on the server anymore
  // (new deployment has different chunk hashes). Only fix is a full reload.
  const isChunkError =
    error.name === 'ChunkLoadError' ||
    (error.message || '').includes('Loading chunk') ||
    (error.message || '').includes('Loading CSS chunk');

  const handleReset = () => {
    if (isChunkError) {
      window.location.reload();
    } else {
      reset();
    }
  };

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Vantage — Error</title>
      </head>
      <body style={{
        background: '#0a0e27',
        margin: 0,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        <div style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: 32,
          maxWidth: 480,
          width: '100%',
        }}>
          <h2 style={{ color: '#ef4444', fontSize: 18, margin: '0 0 4px' }}>
            {isChunkError ? '⚠️ New Version Available' : '⚠️ Fatal Error'}
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 16px' }}>
            {isChunkError
              ? 'The app was updated while you had it open. A quick refresh will get you back on track.'
              : 'Layout-level crash — error boundary caught it.'}
          </p>
          <div style={{
            background: '#1a0a0a',
            border: '1px solid #7f1d1d',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
            fontSize: 12,
            color: '#fca5a5',
            fontFamily: 'monospace',
            lineHeight: 1.6,
            wordBreak: 'break-word',
          }}>
            <div style={{ marginBottom: 4, color: '#ef4444', fontWeight: 700 }}>{error.name}</div>
            <div>{error.message}</div>
            {error.stack && (
              <div style={{ marginTop: 8, fontSize: 10, color: '#7f1d1d', whiteSpace: 'pre-wrap' }}>
                {error.stack.split('\n').slice(0, 10).join('\n')}
              </div>
            )}
          </div>
          <button
            onClick={handleReset}
            style={{
              width: '100%',
              padding: 14,
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
              color: '#0f172a',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isChunkError ? 'Reload App' : 'Try Again'}
          </button>
        </div>
      </body>
    </html>
  );
}
