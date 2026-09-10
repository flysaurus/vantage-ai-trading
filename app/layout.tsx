import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { TabSessionGuard } from '@/components/providers/TabSessionGuard';
import { InactivityWarning } from '@/components/providers/InactivityWarning';
import { MilestoneToastProvider } from '@/context/MilestoneContext';
import { MilestoneToastRenderer } from '@/components/gamification/MilestoneToastRenderer';
import { ThemeProvider, THEME_BOOT_SCRIPT } from '@/lib/theme/theme-provider';
import './globals.css';
import './theme.css';

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <meta name="apple-mobile-web-app-title" content="Vantage" />
        {/* Theme (Light default / Dark / System) — applied before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Service worker kill-switch.
              // A cache-first SW ('vantage-v1') used to be registered here. Disabling
              // the registration does NOT unregister clients that already have it —
              // those devices keep serving the OLD JS chunks forever, which is why
              // shipped changes (PART B chat etc.) appeared "not applied" on a real
              // device while being present in the deployed bundle.
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations()
                  .then(function (rs) { rs.forEach(function (r) { r.unregister(); }); })
                  .catch(function () {});
              }
              if (window.caches && caches.keys) {
                caches.keys()
                  .then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); })
                  .catch(function () {});
              }
            `,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
        <AuthProvider>
          <MilestoneToastProvider>
            <TabSessionGuard>
              <AuthGuard>
                {children}
              </AuthGuard>
              <InactivityWarning />
              <MilestoneToastRenderer />
            </TabSessionGuard>
          </MilestoneToastProvider>
        </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
