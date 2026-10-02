'use client';

import Link from 'next/link';
import { Camera, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { INSPECTION_STATUS_LABELS } from '@sd/shared';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import { fmtNum, fmtPct, type DealershipStats } from '@/lib/stats';
import type { InspectionRequestItem } from '@/lib/types';
import { Card, ErrorAlert, KpiCard, LinkButton, PageHeader, Spinner, statusBadge } from '@/components/ui';

export default function DealershipDashboard() {
  const stats = useQuery({ queryKey: ['company-stats'], queryFn: () => api<{ type: 'DEALERSHIP' } & DealershipStats>('/company/stats') });
  const requests = useQuery({ queryKey: ['inspection-requests', 'open'], queryFn: () => api<InspectionRequestItem[]>('/inspection-requests?view=open') });
  const k = stats.data?.kpis;
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Ihre Fahrzeuge, Auktionen und Verkäufe auf einen Blick." />
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

      <Link href="/autohaus/melden" className="flex items-center justify-between gap-4 rounded-xl bg-brand-700 p-6 text-white shadow-md transition hover:bg-brand-800 sm:p-8">
        <span className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15">
            <Camera className="h-7 w-7" aria-hidden />
          </span>
          <span>
            <span className="block text-xl font-semibold sm:text-2xl">Inzahlungnahmen stehen bereit</span>
            <span className="block text-sm text-white/80">Fahrzeugaufnahme anfordern – unser Außendienst fotografiert und erfasst alles vor Ort.</span>
          </span>
        </span>
        <ChevronRight className="h-8 w-8 shrink-0" aria-hidden />
      </Link>

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
