'use client';

import Link from 'next/link';
import { Camera, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { INSPECTION_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import { useMe } from '@/lib/session';
import { fmtNum, fmtPct, type DealershipStats } from '@/lib/stats';
import type { InspectionRequestItem } from '@/lib/types';
import { Card, ErrorAlert, KpiCard, LinkButton, Spinner, statusBadge } from '@/components/ui';

export default function DealershipDashboard() {
  const me = useMe();
  const stats = useQuery({ queryKey: ['company-stats'], queryFn: () => api<{ type: 'DEALERSHIP' } & DealershipStats>('/company/stats') });
  const requests = useQuery({ queryKey: ['inspection-requests', 'open'], queryFn: () => api<InspectionRequestItem[]>('/inspection-requests?view=open') });
  const k = stats.data?.kpis;
  const companyName = me.data?.company?.name?.replace('[DEMO] ', '') ?? 'Autohaus';
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-sidebar px-6 py-8 text-white shadow-lg sm:px-9" data-testid="dashboard-hero">
        <div className="pointer-events-none absolute -right-20 -top-16 h-72 w-72 rounded-full bg-brand-600/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-32 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" aria-hidden />
        <div className="relative max-w-2xl">
          <p className="text-sm font-medium text-slate-300">Willkommen zurück, {companyName}.</p>
          <h1 className="mt-1.5 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Machen Sie mehr aus Ihren Inzahlungnahmen.</h1>
          <p className="mt-2.5 text-sm text-slate-300 sm:text-base">Vereinbaren Sie Aufnahmetermine für Ihre Inzahlungnahmen. Unser Team holt die Fahrzeuge bei Ihnen vor Ort ab und bereitet sie professionell für die Auktion auf.</p>
          <LinkButton href="/autohaus/melden" className="mt-5" size="lg" icon={<Camera className="h-5 w-5" aria-hidden />}>
            Inzahlungnahme melden
          </LinkButton>
        </div>
      </section>
      {stats.isLoading ? (
        <Spinner />
      ) : (
        <>
          <ErrorAlert error={stats.error} />
          {k && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard label="Fahrzeuge diesen Monat" value={fmtNum(k.vehiclesMonth)} />
              <KpiCard label="Fahrzeuge dieses Jahr" value={fmtNum(k.vehiclesYear)} />
              <KpiCard label="Aktuell in Auktion" value={fmtNum(k.inAuction)} emphasis />
              <KpiCard label="Verkauft" value={fmtNum(k.sold)} hint={`Verkaufsquote ${fmtPct(k.saleRate)}`} />
              <KpiCard label="Nicht verkauft" value={fmtNum(k.unsold)} />
              <KpiCard label="Gesamtverkaufswert" value={formatEuro(k.totalSales, { whole: true })} />
              <KpiCard label="Ø Verkaufspreis" value={formatEuro(k.avgSalePrice, { whole: true })} />
              <KpiCard label="Ø Dauer bis Verkauf" value={k.avgDaysToSale !== null ? `${fmtNum(k.avgDaysToSale, 1)} Tage` : '–'} hint="ab Abschluss der Fahrzeugaufnahme" />
            </div>
          )}
        </>
      )}

      <Card title="Offene Aufnahmeaufträge" actions={<LinkButton href="/autohaus/termine" variant="ghost" size="sm">Alle Termine</LinkButton>}>
        {requests.isLoading ? (
          <Spinner />
        ) : requests.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {requests.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {r.number} · {r.vehicleCount} Fahrzeug(e)
                  </p>
                  <p className="text-sm text-slate-600">{r.statusText}</p>
                </div>
                {statusBadge(INSPECTION_STATUS_LABELS, r.status)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Keine offenen Aufträge.</p>
        )}
      </Card>
    </div>
  );
}
