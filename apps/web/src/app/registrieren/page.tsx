import Link from 'next/link';
import { Building2, Store } from 'lucide-react';
import { PublicLayout } from '@/components/public-layout';

export default function RegisterChoice() {
  return (
    <PublicLayout wide>
      <h1 className="mb-2 text-2xl font-semibold">Unternehmen registrieren</h1>
      <p className="mb-6 text-sm text-slate-600">
        Die Plattform steht ausschließlich gewerblichen Unternehmen offen. Nach der Registrierung prüfen wir Ihren Gewerbenachweis. Eine Teilnahme ist erst nach Freigabe möglich.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/registrieren/autohaus" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-500">
          <Building2 className="mb-3 h-8 w-8 text-brand-700" aria-hidden />
          <h2 className="font-semibold">Autohaus / Einlieferer</h2>
          <p className="mt-1 text-sm text-slate-600">Inzahlungnahmen melden, Fahrzeugaufnahme durch unseren Außendienst, Verkauf an geprüfte Händler.</p>
        </Link>
        <Link href="/registrieren/haendler" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-500">
          <Store className="mb-3 h-8 w-8 text-brand-700" aria-hidden />
          <h2 className="font-semibold">Händler / Käufer</h2>
          <p className="mt-1 text-sm text-slate-600">Geprüfte Fahrzeuge mit standardisierter Zustandsaufnahme ersteigern.</p>
        </Link>
      </div>
    </PublicLayout>
  );
}
