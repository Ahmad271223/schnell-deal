import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// Content-Security-Policy: Bilder/Downloads kommen über Signed URLs vom Objektspeicher, Karten-Kacheln von OpenStreetMap.
const storageOrigin = process.env.CSP_STORAGE_ORIGIN ?? 'http://localhost:9000';
const wsOrigin = process.env.NEXT_PUBLIC_WS_URL ? new URL(process.env.NEXT_PUBLIC_WS_URL).origin : '';
const csp = [
  "default-src 'self'",
  // Next.js benötigt Inline-Skripte für die Hydration (ohne Nonce-Middleware).
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${storageOrigin} https://*.tile.openstreetmap.org`,
  `connect-src 'self' ${wsOrigin} ${storageOrigin} ws: wss:`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
];

export default {
  reactStrictMode: true,
  allowedDevOrigins: ['*.preview.emergentagent.com', '*.preview.emergentcf.cloud', '*.cluster-5.preview.emergentcf.cloud'],
  // Separates Build-Verzeichnis z. B. für E2E-Tests parallel zum Dev-Server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Standalone-Ausgabe nur im Container-Build (benötigt Symlinks, unter Windows ohne Adminrechte nicht möglich).
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: path.join(here, '../..'),
  transpilePackages: ['@sd/shared'],
  poweredByHeader: false,
  // ESLint läuft als eigener Schritt (pnpm lint) mit der Workspace-Konfiguration.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
