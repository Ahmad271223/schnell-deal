import Link from 'next/link';
import type { ReactNode } from 'react';

export function PublicLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-700 text-sm font-bold text-white">SD</span>
            <span className="text-sm font-semibold">Schnell-Deal · B2B Fahrzeugauktionen</span>
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/login" className="text-slate-600 hover:text-slate-900">Anmelden</Link>
            <Link href="/registrieren" className="text-slate-600 hover:text-slate-900">Registrieren</Link>
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-8 ${wide ? 'max-w-3xl' : 'max-w-md'}`}>{children}</main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <Link href="/rechtliches/TERMS" className="mx-2 hover:underline">AGB</Link>
        <Link href="/rechtliches/BIDDER_TERMS" className="mx-2 hover:underline">Bieterbedingungen</Link>
        <Link href="/rechtliches/PRIVACY" className="mx-2 hover:underline">Datenschutz</Link>
        <Link href="/rechtliches/IMPRINT" className="mx-2 hover:underline">Impressum</Link>
      </footer>
    </div>
  );
}
