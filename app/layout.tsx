import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { EmailGateProvider } from '@/hooks/useEmailGate';
import { InactivityWarning } from '@/components/providers/InactivityWarning';
import { MilestoneToastProvider } from '@/context/MilestoneContext';
import { MilestoneToastRenderer } from '@/components/gamification/MilestoneToastRenderer';
import { DebugOverlayWrapper } from '@/components/debug/DebugOverlayWrapper';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vantage — AI Portfolio Analysis',
  description: 'Institutional-quality AI portfolio analysis. Built for everyone. Your AI portfolio analyst, available 24/7.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vantage',
  },
  openGraph: {
    title: 'Vantage — AI Portfolio Analysis',
    description: 'Institutional-quality AI portfolio analysis. Built for everyone.',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="apple-mobile-web-app-title" content="Vantage" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // SW disabled — diagnosing React #310 (stale cache serving old JS chunks)
              // if ('serviceWorker' in navigator) {
              //   window.addEventListener('load', () => {
              //     navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
              //   });
              // }
            `,
          }}
        />
      </head>
      <body>
        <AuthProvider>
          <EmailGateProvider>
            <MilestoneToastProvider>
              <AuthGuard>
                {children}
              </AuthGuard>
              <InactivityWarning />
              <MilestoneToastRenderer />
              <DebugOverlayWrapper />
            </MilestoneToastProvider>
          </EmailGateProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
