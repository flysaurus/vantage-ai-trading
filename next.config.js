/** @type {import('next').NextConfig} */

// BugPin bug-report widget host (testers only — see lib/tester/bugpin.ts).
// The embed is a cross-origin script that also calls back to its own API, so the
// exact origin must be allow-listed in script-src + connect-src. Without it the
// script is fetched but NEVER executed (window.BugPin stays undefined and the
// launcher never mounts) — CSP violations are silent in the UI.
// Derived from the same env var the client uses so the two can't drift.
const BUGPIN_WIDGET_URL =
  process.env.NEXT_PUBLIC_BUGPIN_WIDGET_URL ||
  'https://vmi3186946-2.tailc64401.ts.net/widget.js';
const BUGPIN_ORIGIN = (() => {
  try {
    return new URL(BUGPIN_WIDGET_URL).origin;
  } catch {
    return 'https://vmi3186946-2.tailc64401.ts.net';
  }
})();

const nextConfig = {
  turbopack: {},
  productionBrowserSourceMaps: true,
  typescript: { ignoreBuildErrors: true },

  // nodemailer and friends are Node-only — prevent webpack from bundling them
  // into client-side code via the import chain:
  //   notifications.ts → email.ts → nodemailer (dns, fs, net)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        dns: false,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },

  // Security headers for production
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' " + BUGPIN_ORIGIN,
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.supabase.co https://api.alpaca.markets https://paper-api.alpaca.markets wss://*.alpaca.markets https://api.deepseek.com " +
                BUGPIN_ORIGIN,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
