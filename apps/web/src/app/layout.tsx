import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-jakarta', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jbmono = JetBrains_Mono({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-jbmono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Schnell-Deal – B2B Fahrzeugauktionen', template: '%s · Schnell-Deal' },
  description: 'B2B-Fahrzeugauktionsplattform für Autohäuser und gewerbliche Händler',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B0F17',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`${jakarta.variable} ${inter.variable} ${jbmono.variable}`}>
      <body className="min-h-screen bg-shell font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
